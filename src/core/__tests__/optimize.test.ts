import { optimize, equatorFacing } from "../optimize";
import { simulateYear } from "../simulate";
import { createTracer, traced } from "../trace";
import { fixtures, siteNames, params, close, yearFor } from "./helpers";

describe("optimizer", () => {
  for (const n of siteNames) {
    it(`${n}: matches pvlib brute-force optimum`, async () => {
      const w = await yearFor(n);
      const r = optimize(w, params);
      const ref = fixtures.sites[n].optimum;
      close(r.annual, ref.annual, 1e-3);
      expect(Math.abs(r.best.tilt - ref.tilt)).toBeLessThanOrEqual(2);
      if (ref.tilt > 0) expect(Math.abs(((r.best.azimuth - ref.azimuth + 540) % 360) - 180)).toBeLessThanOrEqual(4);
    }, 30_000);
  }
  it("faces south in the north, north in the south; tilt grows with latitude", async () => {
    const [mad, osl, syd] = await Promise.all([yearFor("madrid"), yearFor("oslo"), yearFor("sydney")]);
    const m = optimize(mad, params), o = optimize(osl, params), s = optimize(syd, params);
    expect(Math.abs(m.best.azimuth - 180)).toBeLessThanOrEqual(5);
    expect(Math.min(s.best.azimuth, 360 - s.best.azimuth)).toBeLessThanOrEqual(5);
    expect(o.best.tilt).toBeGreaterThan(m.best.tilt);
  }, 30_000);
  it("flat optimum near the equator is reported equator-facing", () => {
    expect(equatorFacing(-0.18)).toBe(0);
    expect(equatorFacing(10)).toBe(180);
  });
  it("optimum is not beaten by any heatmap cell or a nearby orientation", async () => {
    const w = await yearFor("madrid");
    const r = optimize(w, params);
    const maxCell = Math.max(...r.heatmap.values.flat());
    expect(r.annual).toBeGreaterThanOrEqual(maxCell - 1e-9);
    for (const [dt, da] of [[1, 0], [-1, 0], [0, 2], [0, -2]]) {
      const v = simulateYear(w, { tilt: r.best.tilt + dt, azimuth: r.best.azimuth + da }, params).annual;
      expect(v).toBeLessThanOrEqual(r.annual + 1e-9);
    }
  }, 30_000);
  it("heatmap is 19 tilts × 36 azimuths with a constant flat row", async () => {
    const w = await yearFor("madrid");
    const r = optimize(w, params);
    expect(r.heatmap.tilts.length).toBe(19);
    expect(r.heatmap.azimuths.length).toBe(36);
    expect(new Set(r.heatmap.values[0]).size).toBe(1);
  }, 30_000);
  it("trace records coarse and refined bests", async () => {
    const w = await yearFor("madrid");
    const t = createTracer();
    const r = optimize(w, params, {}, t);
    expect(traced(t, "opt.refined")).toBe(r.annual);
    expect(traced(t, "opt.coarse")).toBeLessThanOrEqual(r.annual);
  }, 30_000);
});
