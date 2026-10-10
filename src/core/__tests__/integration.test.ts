/**
 * End-to-end integration tests: the full calculation the app runs, for five
 * real places on four continents, against an independent pvlib calculation
 * (reference/generate_integration_fixtures.py).
 *
 * Pipeline under test (same calls as src/main.ts + src/worker.ts):
 *   clearSkySource.year → optimize → simulateYear (optimum, current) → compare
 *   → energyKWh → buildShading + simulateYear (terrain)
 */
import fx from "../__fixtures__/integration.json";
import { buildShading, clearSkySource, compare, energyKWh, optimize, simulateYear, type ModelParams, type WeatherYear } from "..";
import { close } from "./helpers";

const params: ModelParams = { linkeTurbidity: fx.meta.linkeTurbidity, albedo: fx.meta.albedo, transposition: "haydavies" };
const system = { kWp: fx.meta.kWp, performanceRatio: fx.meta.performanceRatio };

type Key = keyof typeof fx.sites;
const keys = Object.keys(fx.sites) as Key[];
const azDiff = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe.each(keys)("full calculation: %s", (key) => {
  const ref = fx.sites[key];
  let w: WeatherYear;
  beforeAll(async () => {
    w = await clearSkySource.year({ lat: ref.lat, lon: ref.lon, altitude: ref.alt }, params);
  });

  it(`${ref.name}: optimal orientation`, () => {
    const opt = optimize(w, params);
    expect(Math.abs(opt.best.tilt - ref.optimum.tilt)).toBeLessThanOrEqual(2);
    expect(azDiff(opt.best.azimuth, ref.optimum.azimuth)).toBeLessThanOrEqual(4);
    close(opt.annual, ref.optimum.annual, 1e-3);
    // faces the equator: north in the southern hemisphere, south in the northern
    expect(azDiff(opt.best.azimuth, ref.lat >= 0 ? 180 : 0)).toBeLessThanOrEqual(10);
  }, 30_000);

  it(`${ref.name}: monthly, daily and annual sunlight for the optimum and the current panel`, () => {
    const o = simulateYear(w, { tilt: ref.optimum.tilt, azimuth: ref.optimum.azimuth }, params);
    const c = simulateYear(w, { tilt: ref.current.tilt, azimuth: ref.current.azimuth }, params);
    close(o.annual, ref.optimum.annual, 1e-3);
    close(c.annual, ref.current.annual, 1e-3);
    o.monthly.forEach((m, k) => close(m, ref.optimum.monthly[k], 2e-3, 0.05));
    c.monthly.forEach((m, k) => close(m, ref.current.monthly[k], 2e-3, 0.05));
    c.dailyAvg.forEach((d, k) => close(d, ref.current.dailyAvg[k], 2e-3, 0.002));
  });

  it(`${ref.name}: loss vs optimum and electricity`, () => {
    const o = simulateYear(w, { tilt: ref.optimum.tilt, azimuth: ref.optimum.azimuth }, params);
    const c = simulateYear(w, { tilt: ref.current.tilt, azimuth: ref.current.azimuth }, params);
    const cmp = compare(c, o);
    close(cmp.lossAnnualPct, ref.lossAnnualPct, 0, 0.1);
    cmp.lossMonthlyPct.forEach((p, k) => close(p, ref.lossMonthlyPct[k], 0, 0.3));
    close(energyKWh(c.annual, system), ref.energyCurrentKWh, 1e-3);
    close(energyKWh(o.annual, system), ref.energyOptimumKWh, 1e-3);
  });

  it(`${ref.name}: terrain shading (synthetic ridge on the equator side)`, () => {
    const sh = buildShading(w, { stepDeg: 5, elevations: ref.terrain.profile });
    const open = simulateYear(w, { tilt: ref.current.tilt, azimuth: ref.current.azimuth }, params);
    const shaded = simulateYear(w, { tilt: ref.current.tilt, azimuth: ref.current.azimuth }, params, undefined, sh);
    close(shaded.annual, ref.terrain.currentAnnual, 1e-3);
    shaded.monthly.forEach((m, k) => close(m, ref.terrain.currentMonthly[k], 3e-3, 0.05));
    close(((open.annual - shaded.annual) / open.annual) * 100, ref.terrain.terrainLossPct, 0, 0.1);
    const optAtOpen = simulateYear(w, { tilt: ref.optimum.tilt, azimuth: ref.optimum.azimuth }, params, undefined, sh);
    close(optAtOpen.annual, ref.terrain.optimumOrientationAnnual, 1e-3);
    expect(shaded.annual).toBeLessThan(open.annual);
  });
});

describe("integration: sanity across sites", () => {
  it("all five sites give plausible clear-sky totals (2,000–3,000 kWh/m²/yr at the optimum)", () => {
    for (const k of keys) {
      expect(fx.sites[k].optimum.annual).toBeGreaterThan(2000);
      expect(fx.sites[k].optimum.annual).toBeLessThan(3000);
    }
  });
  it("optimal tilt is lower near the tropics (Alice Springs) than at mid-latitudes", () => {
    expect(fx.sites.aliceSprings.optimum.tilt).toBeLessThan(fx.sites.alicante.optimum.tilt);
    expect(fx.sites.aliceSprings.optimum.tilt).toBeLessThan(fx.sites.tokyo.optimum.tilt);
  });
});
