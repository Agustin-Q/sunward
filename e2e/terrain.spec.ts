import { test, expect, openAt, expectNoAppErrors } from "./fixtures";

/** Fake Open-Meteo elevation service: a ridge 4 km to the south-east of the site. */
function fakeElevation(site: { lat: number; lon: number }) {
  const R = 6371008.8, rad = Math.PI / 180;
  return (lat: number, lon: number) => {
    const la1 = site.lat * rad, lo1 = site.lon * rad, la2 = lat * rad, lo2 = lon * rad;
    const d = 2 * R * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
    const b = (Math.atan2(Math.sin(lo2 - lo1) * Math.cos(la2), Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1)) / rad + 360) % 360;
    const db = ((b - 140 + 540) % 360) - 180;
    return 300 + 900 * Math.exp(-0.5 * (db / 35) ** 2) * Math.exp(-0.5 * ((d - 4000) / 1500) ** 2);
  };
}

test("terrain shading at the user site computes a skyline and renders without errors", async ({ page, problems }) => {
  void problems;
  const site = { lat: 38.71729, lon: 0.16168 };
  const z = fakeElevation(site);
  let requests = 0;
  await page.route("https://api.open-meteo.com/**", async (route) => {
    requests++;
    const u = new URL(route.request().url());
    const lats = u.searchParams.get("latitude")!.split(",").map(Number);
    const lons = u.searchParams.get("longitude")!.split(",").map(Number);
    await route.fulfill({ status: 200, headers: { "access-control-allow-origin": "*" }, contentType: "application/json", body: JSON.stringify({ elevation: lats.map((la, i) => z(la, lons[i])) }) });
  });
  await openAt(page, `lat=${site.lat}&lon=${site.lon}&alt=320`);
  await page.check("#hz-on");
  await expect(page.locator("#hz-msg")).toContainText("Skyline ready", { timeout: 30_000 });
  expect(requests).toBe(18);
  await expect(page.locator("#terrain-line")).toBeVisible();
  await expect(page).toHaveURL(/hm=1.*hp=|hp=.*hm=1/);
  await page.click("#tab-debug");
  await expect(page.locator("#dbg-horizon-card")).toBeVisible();
  await expect(page.locator("#log-list")).toContainText("Horizon computed");
  await expectNoAppErrors(page);
});
