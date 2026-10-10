import { simulateYear } from "../simulate";
import { createTracer, traced } from "../trace";
import { fixtures, siteNames, params, close, yearFor } from "./helpers";
import type { TranspositionModel } from "../types";

describe("yearly simulation (vs pvlib)", () => {
  for (const n of siteNames) {
    it(`${n}: monthly and annual kWh/m² for 7 orientations × 2 models`, async () => {
      const w = await yearFor(n);
      for (const y of fixtures.sites[n].yearly) {
        const r = simulateYear(w, { tilt: y.tilt, azimuth: y.azimuth }, { ...params, transposition: y.model as TranspositionModel });
        close(r.annual, y.annual, 1e-3);
        r.monthly.forEach((m, k) => close(m, y.monthly[k], 2e-3, 0.05));
      }
    });
  }
  it("daily average = monthly / days, annual = Σ monthly, components add up", async () => {
    const w = await yearFor("madrid");
    const r = simulateYear(w, { tilt: 30, azimuth: 180 }, params);
    close(r.dailyAvg[1], r.monthly[1] / 28, 1e-12);
    close(r.dailyAvg[0], r.monthly[0] / 31, 1e-12);
    close(r.annual, r.monthly.reduce((a, b) => a + b), 1e-12);
    close(r.components.direct + r.components.skyDiffuse + r.components.ground, r.annual, 1e-9);
  });
  it("flat panel annual equals annual GHI (to 1e-6; Rb guard differs only within 1° of the horizon)", async () => {
    const w = await yearFor("oslo");
    const ghi = w.ghi.reduce((a, b) => a + b, 0) / 1000;
    close(simulateYear(w, { tilt: 0, azimuth: 180 }, params).annual, ghi, 1e-6);
  });
  it("trace records each month and the annual total", async () => {
    const w = await yearFor("madrid");
    const t = createTracer();
    const r = simulateYear(w, { tilt: 35, azimuth: 180 }, params, t);
    expect(traced(t, "sum.annual")).toBe(r.annual);
    expect(traced(t, "sum.monthly.6")).toBe(r.monthly[6]);
    expect(traced(t, "sum.daily.6")).toBe(r.dailyAvg[6]);
  });
});
