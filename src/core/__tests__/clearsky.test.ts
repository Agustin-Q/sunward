import { ineichen } from "../clearsky";
import { createTracer, traced } from "../trace";
import { fixtures, close } from "./helpers";

describe("Ineichen clear sky (vs pvlib.clearsky.ineichen)", () => {
  for (const c of fixtures.pure.ineichen) {
    it(`z=${c.apparentZenith}° AM=${c.airmassAbsolute} TL=${c.linkeTurbidity} h=${c.altitude}`, () => {
      const r = ineichen(c.apparentZenith, c.airmassAbsolute, c.linkeTurbidity, c.altitude, c.dniExtra);
      close(r.ghi, c.ghi, 1e-9, 1e-9);
      close(r.dni, c.dni, 1e-9, 1e-9);
      close(r.dhi, c.dhi, 1e-9, 1e-9);
    });
  }
  it("returns zeros at night", () => {
    expect(ineichen(95, NaN, 3, 0, 1366)).toEqual({ ghi: 0, dni: 0, dhi: 0 });
  });
  it("closure: GHI = DNI·cos z + DHI", () => {
    const r = ineichen(50, 1.55, 3, 500, 1366);
    close(r.dni * Math.cos((50 * Math.PI) / 180) + r.dhi, r.ghi, 1e-12);
  });
  it("hazier sky → less beam, more diffuse share", () => {
    const clean = ineichen(40, 1.3, 2, 0, 1366), hazy = ineichen(40, 1.3, 5, 0, 1366);
    expect(hazy.dni).toBeLessThan(clean.dni);
    expect(hazy.dhi / hazy.ghi).toBeGreaterThan(clean.dhi / clean.ghi);
  });
  it("trace contains the returned values", () => {
    const t = createTracer();
    const r = ineichen(30, 1.15, 3, 0, 1366.1, t);
    expect(traced(t, "clearsky.ghi")).toBe(r.ghi);
    expect(traced(t, "clearsky.dni")).toBe(r.dni);
    expect(traced(t, "clearsky.dhi")).toBe(r.dhi);
  });
});
