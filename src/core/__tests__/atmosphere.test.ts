import { altitudeToPressure, relativeAirmass, absoluteAirmass, P0 } from "../atmosphere";
import { extraterrestrialIrradiance, SOLAR_CONSTANT } from "../extraterrestrial";
import { createTracer, traced } from "../trace";
import { fixtures, close } from "./helpers";

describe("atmosphere (vs pvlib)", () => {
  it("altitude → pressure matches pvlib.atmosphere.alt2pres", () => {
    const { altitude, pressure } = fixtures.pure.alt2pres;
    altitude.forEach((h, i) => close(altitudeToPressure(h), pressure[i], 1e-9));
  });
  it("relative air mass matches Kasten-Young 1989", () => {
    const { zenith, relative } = fixtures.pure.airmass;
    zenith.forEach((z, i) => close(relativeAirmass(z), relative[i], 1e-9));
  });
  it("air mass is 1 at zenith, NaN below horizon", () => {
    close(relativeAirmass(0), 1, 1e-3);
    expect(relativeAirmass(95)).toBeNaN();
  });
  it("absolute air mass scales with pressure", () => {
    expect(absoluteAirmass(2, P0)).toBe(2);
    expect(absoluteAirmass(2, P0 / 2)).toBe(1);
  });
  it("traces the values it computed", () => {
    const t = createTracer();
    const p = altitudeToPressure(1000, t);
    const am = relativeAirmass(45, t);
    expect(traced(t, "atm.pressure")).toBe(p);
    expect(traced(t, "atm.airmassRelative")).toBe(am);
  });
});

describe("extraterrestrial irradiance (vs pvlib Spencer)", () => {
  it("matches pvlib.irradiance.get_extra_radiation", () => {
    const { doy, value } = fixtures.pure.extraRadiation;
    doy.forEach((n, i) => close(extraterrestrialIrradiance(n), value[i], 1e-9));
  });
  it("is highest near perihelion (Jan) and lowest near aphelion (Jul), within ±3.6%", () => {
    const jan = extraterrestrialIrradiance(3), jul = extraterrestrialIrradiance(185);
    expect(jan).toBeGreaterThan(jul);
    expect(jan / SOLAR_CONSTANT).toBeLessThan(1.036);
    expect(jul / SOLAR_CONSTANT).toBeGreaterThan(0.964);
  });
});
