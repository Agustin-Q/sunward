import { test, expect, openAt, expectNoAppErrors } from "./fixtures";

/**
 * Full app runs at many places. Regression: longitudes whose offset is not a
 * whole number of milliseconds (e.g. 0.16168 near Alicante) made the sun-path
 * chart crash with "instant.epochMilliseconds must be a safe integer".
 */
const PLACES: { name: string; lat: number; lon: number; alt: number; equatorFacing: number }[] = [
  { name: "user site near Alicante (regression)", lat: 38.71729, lon: 0.16168, alt: 320, equatorFacing: 180 },
  { name: "Alicante", lat: 38.3452, lon: -0.481, alt: 10, equatorFacing: 180 },
  { name: "Buenos Aires", lat: -34.6037, lon: -58.3816, alt: 25, equatorFacing: 0 },
  { name: "Madrid", lat: 40.4168, lon: -3.7038, alt: 667, equatorFacing: 180 },
  { name: "Fresno, California", lat: 36.7378, lon: -119.7871, alt: 94, equatorFacing: 180 },
  { name: "Alice Springs, Australia", lat: -23.698, lon: 133.8807, alt: 545, equatorFacing: 0 },
  { name: "Tokyo", lat: 35.6762, lon: 139.6503, alt: 40, equatorFacing: 180 },
  { name: "near the antimeridian (east)", lat: -17.7134, lon: 178.065, alt: 10, equatorFacing: 0 },
  { name: "near the antimeridian (west)", lat: 21.3069, lon: -157.8583, alt: 5, equatorFacing: 180 },
  { name: "Tromsø (polar day and night)", lat: 69.6492, lon: 18.9553, alt: 10, equatorFacing: 180 },
  { name: "Quito (equator)", lat: -0.1807, lon: -78.4678, alt: 2850, equatorFacing: 0 },
];

for (const p of PLACES) {
  test(`full calculation renders without errors: ${p.name}`, async ({ page, problems }) => {
    void problems;
    await openAt(page, `lat=${p.lat}&lon=${p.lon}&alt=${p.alt}&tilt=25&az=200`);
    await expectNoAppErrors(page);
    // optimum shown, sensible and equator-facing (or flat at the equator)
    const opt = await page.locator("#s-opt").textContent();
    const [tilt, az] = (opt ?? "").match(/\d+/g)!.map(Number);
    expect(tilt).toBeGreaterThanOrEqual(0);
    expect(tilt).toBeLessThanOrEqual(90);
    if (tilt > 3) expect(Math.abs(((az - p.equatorFacing + 540) % 360) - 180)).toBeLessThanOrEqual(15);
    // monthly table has 12 rows and the sun-path chart was drawn
    await expect(page.locator("#tbl-monthly tbody tr")).toHaveCount(12);
    const drawn = await page.locator("#sunpath").evaluate((c: HTMLCanvasElement) => c.width > 0);
    expect(drawn).toBe(true);
    // every tab renders without errors
    for (const tab of ["heatmap", "debug", "results"]) {
      await page.click(`#tab-${tab}`);
      await page.waitForTimeout(300);
    }
    await expect(page.locator("#dbg-steps .step").first()).toBeAttached();
    await expectNoAppErrors(page);
  });
}

test("moving the location by typing coordinates recomputes without errors", async ({ page, problems }) => {
  void problems;
  await openAt(page, "lat=40.4168&lon=-3.7038&alt=667");
  await page.fill("#lat", "38.71729");
  await page.dispatchEvent("#lat", "change");
  await page.fill("#lon", "0.16168");
  await page.dispatchEvent("#lon", "change");
  await expect(page).toHaveURL(/lon=0\.16168/, { timeout: 10_000 });
  await page.waitForTimeout(2500);
  await expectNoAppErrors(page);
});
