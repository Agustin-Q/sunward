import type { Page } from "@playwright/test";
import { test, expect, openAt, expectNoAppErrors } from "./fixtures";

const SITE = { lat: 38.72019, lon: 0.16496, alt: 281 };

/** Fake NASA POWER hourly API: a cloudy-ish year (GHI ~60% of a simple clear-sky shape). */
async function serveNasa(page: Page) {
  const asked: string[] = [];
  await page.route("https://power.larc.nasa.gov/**", async (route) => {
    const u = new URL(route.request().url());
    asked.push(u.searchParams.get("start")!);
    const year = Number(u.searchParams.get("start")!.slice(0, 4));
    const lat = Number(u.searchParams.get("latitude")) * (Math.PI / 180);
    const lon = Number(u.searchParams.get("longitude"));
    const P: Record<string, Record<string, number>> = { ALLSKY_SFC_SW_DWN: {}, ALLSKY_SFC_SW_DNI: {}, ALLSKY_SFC_SW_DIFF: {} };
    for (let t = Date.UTC(year, 0, 1); t < Date.UTC(year + 1, 0, 1); t += 3_600_000) {
      const d = new Date(t);
      const doy = Math.floor((t - Date.UTC(year, 0, 1)) / 86_400_000);
      const decl = 23.45 * Math.sin(((360 * (284 + doy)) / 365) * (Math.PI / 180)) * (Math.PI / 180);
      const ha = (15 * (d.getUTCHours() + 0.5 + lon / 15 - 12)) * (Math.PI / 180);
      const cz = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
      const ghi = cz > 0 ? 0.6 * 1000 * cz : 0;
      const dni = cz > 0.05 ? 0.45 * 850 : 0;
      const k = `${year}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}`;
      P.ALLSKY_SFC_SW_DWN[k] = Math.round(ghi);
      P.ALLSKY_SFC_SW_DNI[k] = Math.round(dni);
      P.ALLSKY_SFC_SW_DIFF[k] = Math.round(Math.max(0, ghi - dni * Math.max(cz, 0)));
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ header: { fill_value: -999 }, properties: { parameter: P } }) });
  });
  return asked;
}

const annualYours = async (page: Page) => Number((await page.locator("#s-you").textContent())!.replace(/,/g, ""));

test("NASA POWER real weather: downloads 5 years, lowers totals vs clear sky, traces data, no errors", async ({ page, problems }) => {
  void problems;
  const asked = await serveNasa(page);
  await openAt(page, `lat=${SITE.lat}&lon=${SITE.lon}&alt=${SITE.alt}&tilt=30&az=180`);
  const clear = await annualYours(page);
  await page.click("#model-panel summary");
  await page.selectOption("#source", "nasa-power");
  await expect(page.locator("#source-msg")).toContainText("Using NASA POWER 2019–2023 mean", { timeout: 30_000 });
  await expect.poll(() => annualYours(page), { timeout: 15_000 }).toBeLessThan(clear * 0.8);
  expect(asked).toEqual(["20190101", "20200101", "20210101", "20220101", "20230101"]);
  await expect(page.locator("#caveat")).toContainText("Real weather");
  await expect(page).toHaveURL(/src=nasa-power/);
  await page.click("#tab-debug");
  await expect(page.locator("#dbg-steps")).toContainText("Weather data (NASA POWER");
  await expect(page.locator("#log-list")).toContainText("NASA POWER 2019–2023 mean downloaded");
  await expectNoAppErrors(page);
});

test("NASA POWER is cached: reload makes no new requests", async ({ page, problems }) => {
  void problems;
  const asked = await serveNasa(page);
  await openAt(page, `lat=${SITE.lat}&lon=${SITE.lon}&alt=${SITE.alt}&src=nasa-power`);
  await expect(page.locator("#source-msg")).toContainText("Using NASA POWER", { timeout: 30_000 });
  const n = asked.length;
  await page.reload();
  await expect(page.locator("#source-msg")).toContainText("Using NASA POWER", { timeout: 30_000 });
  expect(asked.length).toBe(n);
});

test("NASA POWER blocked (e.g. CORS) → clear message, clear-sky results, error in the log", async ({ page, problems }) => {
  await openAt(page, `lat=${SITE.lat}&lon=${SITE.lon}&alt=${SITE.alt}&src=nasa-power`);
  await expect(page.locator("#source-msg")).toContainText("Showing clear sky instead", { timeout: 30_000 });
  await expect(page.locator("#s-opt")).not.toHaveText("–");
  await expect(page.locator("#caveat")).toContainText("Clear-sky data ignores clouds");
  await page.click("#tab-debug");
  await expect(page.locator("#log-list")).toContainText("NASA POWER failed");
  // the failure is logged with console capture off; it is an expected app error here
  problems.consoleErrors = [];
});
