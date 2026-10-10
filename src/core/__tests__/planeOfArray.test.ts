import { aoiProjection, planeOfArray } from "../planeOfArray";
import { createTracer, traced } from "../trace";
import { fixtures, close } from "./helpers";

describe("angle of incidence (vs pvlib)", () => {
  for (const c of fixtures.pure.planeOfArray) {
    it(`tilt ${c.tilt} az ${c.surfaceAzimuth}, sun z ${c.zenith} az ${c.azimuth}`, () => {
      close(aoiProjection(c.tilt, c.surfaceAzimuth, c.zenith, c.azimuth), c.aoiProjection, 1e-12, 1e-12);
    });
  }
  it("sun straight on → cos θ = 1; flat panel → cos θ = cos θz", () => {
    close(aoiProjection(40, 180, 40, 180), 1, 1e-12);
    close(aoiProjection(0, 123, 60, 77), 0.5, 1e-12);
  });
});

describe("plane-of-array components (vs pvlib)", () => {
  for (const c of fixtures.pure.planeOfArray) {
    it(`Hay-Davies, isotropic and ground: tilt ${c.tilt} az ${c.surfaceAzimuth}`, () => {
      const hd = planeOfArray({ tilt: c.tilt, azimuth: c.surfaceAzimuth }, c.zenith, c.azimuth, { ghi: 700, dni: c.dni, dhi: c.dhi }, c.dniExtra, 0.2, "haydavies");
      close(hd.isotropic, c.hdIsotropic, 1e-12, 1e-12);
      close(hd.circumsolar, c.hdCircumsolar, 1e-12, 1e-12);
      close(hd.ground, c.ground, 1e-12, 1e-12);
      close(hd.direct, Math.max(c.dni * c.aoiProjection, 0), 1e-12, 1e-12);
      const iso = planeOfArray({ tilt: c.tilt, azimuth: c.surfaceAzimuth }, c.zenith, c.azimuth, { ghi: 700, dni: c.dni, dhi: c.dhi }, c.dniExtra, 0.2, "isotropic");
      close(iso.skyDiffuse, c.isotropic, 1e-12, 1e-12);
      expect(iso.circumsolar).toBe(0);
    });
  }
  it("worked example from the explanation (Madrid equinox noon)", () => {
    const r = planeOfArray({ tilt: 35, azimuth: 180 }, 40.4, 180, { ghi: 900 * Math.cos((40.4 * Math.PI) / 180) + 100, dni: 900, dhi: 100 }, 1369.6, 0.2, "haydavies");
    close(r.direct, 896, 0.002);
    close(r.skyDiffuse, 117, 0.01);
    close(r.ground, 14.2, 0.01);
    close(r.global, 1027, 0.003);
  });
  it("flat panel gets exactly GHI (no ground term, Rb = 1 → Hay-Davies = isotropic)", () => {
    const irr = { ghi: 600, dni: 700, dhi: 600 - 700 * Math.cos(Math.PI / 4) };
    const r = planeOfArray({ tilt: 0, azimuth: 180 }, 45, 150, irr, 1360, 0.2, "haydavies");
    close(r.global, irr.ghi, 1e-12);
    expect(r.ground).toBe(0);
  });
  it("sun behind the panel → no beam, no circumsolar", () => {
    const r = planeOfArray({ tilt: 70, azimuth: 0 }, 30, 180, { ghi: 800, dni: 800, dhi: 107 }, 1360, 0.2, "haydavies");
    expect(r.direct).toBe(0);
    expect(r.circumsolar).toBe(0);
    expect(r.isotropic).toBeGreaterThan(0);
  });
  it("trace values equal the returned components", () => {
    const t = createTracer();
    const r = planeOfArray({ tilt: 30, azimuth: 170 }, 35, 160, { ghi: 850, dni: 850, dhi: 150 }, 1360, 0.25, "haydavies", t);
    expect(traced(t, "poa.direct")).toBe(r.direct);
    expect(traced(t, "poa.circumsolar")).toBe(r.circumsolar);
    expect(traced(t, "poa.isotropic")).toBe(r.isotropic);
    expect(traced(t, "poa.ground")).toBe(r.ground);
    expect(traced(t, "poa.global")).toBe(r.global);
  });
});
