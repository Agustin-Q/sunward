import { compare } from "../compare";
import { energyKWh } from "../energy";
import { simulateYear, type YearResult } from "../simulate";
import { createTracer, traced } from "../trace";
import { params, close, yearFor } from "./helpers";

const yr = (tilt: number, azimuth: number, monthly: number[]): YearResult => ({
  orientation: { tilt, azimuth }, monthly, dailyAvg: monthly.map((m) => m / 30), annual: monthly.reduce((a, b) => a + b), components: { direct: 0, skyDiffuse: 0, ground: 0 },
});

describe("loss comparison", () => {
  it("computes deviation and loss with hand-checked numbers", () => {
    const opt = yr(38, 180, Array(12).fill(200));
    const cur = yr(20, 135, Array(12).fill(180));
    const c = compare(cur, opt);
    expect(c.deviation).toEqual({ tilt: -18, azimuth: -45 });
    close(c.lossAnnual, 240, 1e-12);
    close(c.lossAnnualPct, 10, 1e-12);
    c.lossMonthlyPct.forEach((p) => close(p, 10, 1e-12));
  });
  it("azimuth deviation wraps across north", () => {
    expect(compare(yr(30, 350, [1]), yr(30, 10, [1])).deviation.azimuth).toBe(-20);
  });
  it("comparing the optimum with itself gives zero loss", async () => {
    const w = await yearFor("madrid");
    const r = simulateYear(w, { tilt: 38, azimuth: 180 }, params);
    const c = compare(r, r);
    expect(c.lossAnnual).toBe(0);
    expect(c.lossAnnualPct).toBe(0);
  });
  it("a month can be better than optimal (negative loss), e.g. steep panel in winter", async () => {
    const w = await yearFor("madrid");
    const c = compare(simulateYear(w, { tilt: 70, azimuth: 180 }, params), simulateYear(w, { tilt: 38, azimuth: 180 }, params));
    expect(c.lossMonthlyPct[11]).toBeLessThan(0); // December
    expect(c.lossAnnualPct).toBeGreaterThan(0);
  });
  it("trace contains the annual loss", () => {
    const t = createTracer();
    const c = compare(yr(20, 135, [90]), yr(38, 180, [100]), t);
    expect(traced(t, "loss.annualPct")).toBe(c.lossAnnualPct);
  });
});

describe("energy", () => {
  it("E = H × kWp × PR", () => {
    expect(energyKWh(2000, { kWp: 5, performanceRatio: 0.8 })).toBe(8000);
    expect(energyKWh(0, { kWp: 5, performanceRatio: 0.8 })).toBe(0);
  });
  it("rejects invalid specs", () => {
    expect(() => energyKWh(100, { kWp: 5, performanceRatio: 1.2 })).toThrow(RangeError);
    expect(() => energyKWh(100, { kWp: -1, performanceRatio: 0.8 })).toThrow(RangeError);
  });
  it("traces the substituted formula", () => {
    const t = createTracer();
    energyKWh(1500, { kWp: 4, performanceRatio: 0.75 }, t, "annual");
    expect(traced(t, "energy.annual")).toBe(4500);
  });
});
