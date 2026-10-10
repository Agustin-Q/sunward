import shadingFx from "../__fixtures__/shading.json";
import {
  decodeProfile, encodeProfile, flatHorizon, horizonAt, horizonMax, isValidProfile, resample, skyViewFactor, sunVisible, traceShade,
  type HorizonProfile,
} from "../horizon";
import { planeOfArray } from "../planeOfArray";
import { buildShading } from "../shading";
import { simulateYear } from "../simulate";
import { optimize } from "../optimize";
import { createTracer, traced } from "../trace";
import type { TranspositionModel } from "../types";
import { close, params, yearFor } from "./helpers";

type ProfileName = keyof typeof shadingFx.profiles;
const prof = (n: ProfileName): HorizonProfile => ({ stepDeg: shadingFx.meta.stepDeg, elevations: shadingFx.profiles[n] });
const ramp: HorizonProfile = { stepDeg: 90, elevations: [0, 10, 20, 30] };

describe("horizon profile basics", () => {
  it("interpolates linearly and wraps from 360° to 0°", () => {
    expect(horizonAt(ramp, 0)).toBe(0);
    expect(horizonAt(ramp, 45)).toBe(5);
    expect(horizonAt(ramp, 270)).toBe(30);
    expect(horizonAt(ramp, 315)).toBe(15); // between 30 (270°) and 0 (360°)
    expect(horizonAt(ramp, 360)).toBe(0);
    expect(horizonAt(ramp, -45)).toBe(15);
  });
  it("resamples to a finer step without changing the shape", () => {
    const r = resample(ramp, 5);
    expect(r.elevations.length).toBe(72);
    expect(horizonAt(r, 135)).toBeCloseTo(15, 12);
  });
  it("finds the highest point and validates shape", () => {
    expect(horizonMax(ramp)).toEqual({ azimuth: 270, elevation: 30 });
    expect(isValidProfile(flatHorizon())).toBe(true);
    expect(isValidProfile({ stepDeg: 5, elevations: [1, 2] })).toBe(false);
    expect(isValidProfile({ stepDeg: 90, elevations: [0, NaN, 0, 0] })).toBe(false);
  });
  it("sun is visible only above the skyline", () => {
    expect(sunVisible(ramp, 12, 90)).toBe(true);
    expect(sunVisible(ramp, 9, 90)).toBe(false);
    expect(sunVisible(ramp, 10, 90)).toBe(false); // on the line counts as hidden
  });
  it("URL encoding round-trips at 0.5° resolution and rejects junk", () => {
    const p = prof("alpine");
    const s = encodeProfile(p);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(s.length).toBe(96);
    decodeProfile(s)!.elevations.forEach((e, i) => expect(Math.abs(e - p.elevations[i])).toBeLessThanOrEqual(0.25));
    expect(decodeProfile("not base64!")).toBeNull();
    expect(decodeProfile("AAAA")).toBeNull();
    expect(decodeProfile(encodeProfile({ stepDeg: 5, elevations: new Array(72).fill(-3) }))!.elevations[0]).toBe(0); // clamped
  });
});

describe("sky view factor (Dozier & Frew) vs independent reference", () => {
  it("flat horizon gives exactly (1 + cos β)/2", () => {
    for (const tilt of [0, 10, 20, 35, 50, 60, 75, 90]) {
      for (const az of [0, 90, 180, 270]) close(skyViewFactor(flatHorizon(), tilt, az), (1 + Math.cos((tilt * Math.PI) / 180)) / 2, 0, 2e-5);
    }
  });
  for (const r of shadingFx.skyView) {
    it(`${r.profile}, tilt ${r.tilt}°, azimuth ${r.azimuth}°`, () => {
      close(skyViewFactor(prof(r.profile as ProfileName), r.tilt, r.azimuth), r.value, 0, 1e-4);
      if ("monteCarlo" in r) close(r.value, (r as { monteCarlo: number }).monteCarlo, 0, 1e-3); // reference self-check
    });
  }
  it("a higher horizon never increases the sky view, and it stays within [0, 1]", () => {
    for (const h of [0, 5, 10, 20, 40]) {
      const p = { stepDeg: 5, elevations: new Array(72).fill(h) };
      const q = { stepDeg: 5, elevations: new Array(72).fill(h + 5) };
      for (const [t, a] of [[0, 0], [35, 180], [90, 90]]) {
        const v = skyViewFactor(p, t, a);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(skyViewFactor(q, t, a)).toBeLessThanOrEqual(v + 1e-12);
      }
    }
  });
  it("horizontal surface with uniform horizon h sees cos²h of the sky", () => {
    const p = { stepDeg: 5, elevations: new Array(72).fill(20) };
    close(skyViewFactor(p, 0, 0), Math.cos((20 * Math.PI) / 180) ** 2, 0, 1e-9);
  });
});

describe("shaded plane-of-array", () => {
  const irr = { ghi: 800, dni: 850, dhi: 120 };
  it("hidden sun removes beam and circumsolar, keeps (reduced) sky diffuse", () => {
    const shade = { sunVisible: false, skyView: 0.8, skyViewHorizontal: 0.95 };
    const r = planeOfArray({ tilt: 35, azimuth: 180 }, 40, 180, irr, 1360, 0.2, "haydavies", undefined, shade);
    expect(r.direct).toBe(0);
    expect(r.circumsolar).toBe(0);
    close(r.isotropic, 120 * (1 - 850 / 1360) * 0.8, 1e-12);
    close(r.ground, 120 * 0.95 * 0.2 * (1 - Math.cos((35 * Math.PI) / 180)) / 2, 1e-12);
  });
  it("with a flat horizon the shaded model equals the unshaded one", () => {
    const flat = flatHorizon();
    for (const [z, az] of [[30, 150], [60, 250], [80, 100]]) {
      const ghi = 850 * Math.cos((z * Math.PI) / 180) + 120;
      const a = planeOfArray({ tilt: 35, azimuth: 180 }, z, az, { ghi, dni: 850, dhi: 120 }, 1360, 0.2, "haydavies");
      const sh = traceShade(flat, z, az, 35, 180);
      const b = planeOfArray({ tilt: 35, azimuth: 180 }, z, az, { ghi, dni: 850, dhi: 120 }, 1360, 0.2, "haydavies", undefined, sh);
      close(b.global, a.global, 1e-4);
    }
  });
  it("trace records the horizon steps and the shaded values", () => {
    const t = createTracer();
    const sh = traceShade(prof("valley10"), 85, 180, 35, 180, t);
    expect(traced(t, "shade.visible")).toBe(0); // sun 5° up behind a 10° horizon
    expect(traced(t, "shade.horizonAtSun")).toBeCloseTo(10, 12);
    const r = planeOfArray({ tilt: 35, azimuth: 180 }, 85, 180, irr, 1360, 0.2, "haydavies", t, sh);
    expect(traced(t, "poa.direct")).toBe(0);
    expect(traced(t, "poa.global")).toBe(r.global);
    expect(traced(t, "poa.skyView")).toBe(sh.skyView);
  });
});

describe("shaded year (Madrid) vs independent numpy reference", () => {
  for (const name of Object.keys(shadingFx.profiles) as ProfileName[]) {
    it(`${name}: monthly + annual for 5 orientations × 2 diffuse models`, async () => {
      const w = await yearFor("madrid");
      const sh = buildShading(w, prof(name));
      for (const y of shadingFx.yearly.filter((r) => r.profile === name)) {
        const r = simulateYear(w, { tilt: y.tilt, azimuth: y.azimuth }, { ...params, transposition: y.model as TranspositionModel }, undefined, sh);
        close(r.annual, y.annual, 1e-3);
        r.monthly.forEach((m, k) => close(m, y.monthly[k], 2e-3, 0.05));
      }
      const blocked = sh.visible.reduce((a, v, i) => a + (w.ghi[i] > 0 && !v ? 1 : 0), 0);
      const refBlocked = shadingFx.yearly.find((r) => r.profile === name)!.blockedHours;
      // pvlib applies refraction down to 0.83° below the geometric horizon (SPA convention);
      // @yogur/solpos applies none below it, so pvlib has 32 extra sunrise/sunset hours
      // with a few W/m² of light at Madrid. Energy is unaffected (totals match above).
      expect(Math.abs(blocked - refBlocked)).toBeLessThanOrEqual(32 + 3);
    });
  }
  it("flat horizon reproduces the unshaded totals", async () => {
    const w = await yearFor("madrid");
    const a = simulateYear(w, { tilt: 35, azimuth: 180 }, params);
    const b = simulateYear(w, { tilt: 35, azimuth: 180 }, params, undefined, buildShading(w, flatHorizon()));
    close(b.annual, a.annual, 1e-4);
  });
  it("trace reports the sky view and the blocked hours", async () => {
    const w = await yearFor("madrid");
    const t = createTracer();
    simulateYear(w, { tilt: 35, azimuth: 180 }, params, t, buildShading(w, prof("valley10")));
    close(traced(t, "sum.skyView"), 0.8335, 0, 2e-4);
    expect(traced(t, "sum.blockedHours")).toBeGreaterThan(600);
  });
});

describe("shaded optimum", () => {
  for (const name of ["eastRidge", "eastWall", "alpine"] as const) {
    it(`${name}: matches the reference brute force`, async () => {
      const w = await yearFor("madrid");
      const r = optimize(w, params, { shading: buildShading(w, prof(name)) });
      const ref = shadingFx.optimum[name];
      expect(r.annual).toBeGreaterThanOrEqual(ref.annual * (1 - 1e-3)); // finer grid may beat the 2°/3° reference
      expect(Math.abs(r.best.tilt - ref.tilt)).toBeLessThanOrEqual(2);
      expect(Math.abs(r.best.azimuth - ref.azimuth)).toBeLessThanOrEqual(4);
    }, 60_000);
  }
  it("a wall to the east turns the optimum west", async () => {
    const w = await yearFor("madrid");
    const open = optimize(w, params);
    const walled = optimize(w, params, { shading: buildShading(w, prof("eastWall")) });
    expect(walled.best.azimuth).toBeGreaterThan(open.best.azimuth + 10);
    expect(walled.annual).toBeLessThan(open.annual);
  }, 60_000);
});
