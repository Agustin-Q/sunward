import { PNG } from "pngjs";
import type { Page, Route } from "@playwright/test";
import { test, expect, openAt, expectNoAppErrors } from "./fixtures";

const SITE = { lat: 38.72019, lon: 0.16496 }; // the user's site from the 429 report

/** Synthetic terrain: a ridge 4 km to the south-east of the site. */
function elevation(lat: number, lon: number) {
  const R = 6371008.8, rad = Math.PI / 180;
  const la1 = SITE.lat * rad, lo1 = SITE.lon * rad, la2 = lat * rad, lo2 = lon * rad;
  const d = 2 * R * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  const b = (Math.atan2(Math.sin(lo2 - lo1) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1)) / rad + 360) % 360;
  const db = ((b - 140 + 540) % 360) - 180;
  return 280 + 900 * Math.exp(-0.5 * (db / 35) ** 2) * Math.exp(-0.5 * ((d - 4000) / 1500) ** 2);
}

/** Serve Terrarium PNG tiles generated from the synthetic terrain. */
async function serveTiles(page: Page, onTile: () => void = () => {}) {
  await page.route(/elevation-tiles-prod\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/, async (route: Route) => {
    onTile();
    const [, z, x, y] = route.request().url().match(/terrarium\/(\d+)\/(\d+)\/(\d+)\.png/)!.map(Number);
    const png = new PNG({ width: 256, height: 256 });
    const n = 256 * 2 ** z;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const lon = ((x * 256 + i + 0.5) / n) * 360 - 180;
      const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y * 256 + j + 0.5)) / n))) * 180) / Math.PI;
      const v = Math.round((elevation(lat, lon) + 32768) * 256) / 256;
      const r = Math.floor(v / 256), g = Math.floor(v - r * 256), b = Math.round((v - r * 256 - g) * 256);
      const k = 4 * (j * 256 + i);
      png.data[k] = r; png.data[k + 1] = g; png.data[k + 2] = Math.min(255, b); png.data[k + 3] = 255;
    }
    await route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PNG.sync.write(png) });
  });
}

/** Fake Open-Meteo elevation API; `limited` first answers are 429 with Retry-After: 1. */
async function serveOpenMeteo(page: Page, limited = 0) {
  let calls = 0;
  await page.route("https://api.open-meteo.com/**", async (route) => {
    calls++;
    if (calls <= limited) return route.fulfill({ status: 429, headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "retry-after", "retry-after": "1" }, body: "" });
    const u = new URL(route.request().url());
    const lats = u.searchParams.get("latitude")!.split(",").map(Number);
    const lons = u.searchParams.get("longitude")!.split(",").map(Number);
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ elevation: lats.map((la, i) => elevation(la, lons[i])) }) });
  });
  return () => calls;
}

async function turnOnTerrain(page: Page) {
  await openAt(page, `lat=${SITE.lat}&lon=${SITE.lon}&alt=281&hh=6`);
  await page.check("#hz-on");
  await expect(page.locator("#hz-msg")).toContainText("Skyline ready", { timeout: 45_000 });
}

test("terrain from AWS Terrain Tiles: skyline, results, URL and debug, without using Open-Meteo", async ({ page, problems }) => {
  void problems;
  let tiles = 0;
  await serveTiles(page, () => tiles++);
  const omCalls = await serveOpenMeteo(page);
  await turnOnTerrain(page);
  expect(tiles).toBeGreaterThan(10);
  expect(tiles).toBeLessThan(80);
  expect(omCalls()).toBe(0);
  await expect(page.locator("#hz-msg")).toContainText(/toward 1[3-4]\d° SE/);
  await expect(page.locator("#terrain-line")).toBeVisible();
  await expect(page).toHaveURL(/hp=/);
  await page.click("#tab-debug");
  await expect(page.locator("#dbg-horizon-card")).toBeVisible();
  await expect(page.locator("#log-list")).toContainText("Elevation from AWS Terrain Tiles");
  await expectNoAppErrors(page);
});

test("regression: tiles unavailable and Open-Meteo rate-limits (429) → waits, retries, succeeds", async ({ page, problems }) => {
  void problems;
  // tiles stay blocked by the fixture; Open-Meteo answers 429 three times first
  const omCalls = await serveOpenMeteo(page, 3);
  await openAt(page, `lat=${SITE.lat}&lon=${SITE.lon}&alt=281&hh=6`);
  await page.check("#hz-on");
  await expect(page.locator("#hz-msg")).toContainText("asked us to slow down", { timeout: 20_000 });
  await expect(page.locator("#hz-msg")).toContainText("Skyline ready", { timeout: 45_000 });
  expect(omCalls()).toBe(18 + 3);
  await page.click("#tab-debug");
  await expect(page.locator("#log-list")).toContainText("using Open-Meteo instead");
  await expect(page.locator("#log-list")).toContainText("rate limit: waiting 1 s");
  await expect(page.locator("#log-list")).not.toContainText("Elevation download failed");
  await expectNoAppErrors(page);
});

test("both elevation sources down → clear message, results without terrain, no crash", async ({ page, problems }) => {
  void problems;
  await page.route("https://api.open-meteo.com/**", (r) => r.fulfill({ status: 500, headers: { "access-control-allow-origin": "*" }, body: "" }));
  await openAt(page, `lat=${SITE.lat}&lon=${SITE.lon}&alt=281`);
  await page.check("#hz-on");
  await expect(page.locator("#hz-msg")).toContainText("Couldn't download elevation data", { timeout: 45_000 });
  await expect(page.locator("#s-opt")).not.toHaveText("–");
  await expect(page.locator("#loc-msg")).not.toHaveText(/failed/i);
});
