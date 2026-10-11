import { sunPosition } from "../solarPosition";
import { calculateSolarPosition } from "@yogur/solpos";
import { createTracer, traced } from "../trace";
import { fixtures, siteNames, siteOf, close } from "./helpers";
import { textbookSun } from "../textbook";

describe("solar position", () => {
  it("library reproduces the NREL SPA reference case (Reda & Andreas 2008, Table A4.1)", () => {
    const r = calculateSolarPosition({
      instant: { epochMilliseconds: Date.UTC(2003, 9, 17, 19, 30, 30) },
      observer: { latitudeDegrees: 39.742476, longitudeDegrees: -105.1786, elevationMeters: 1830.14 },
      atmosphere: { pressureMillibars: 820, temperatureCelsius: 11 },
      timeScales: { deltaTSeconds: 67, ut1MinusUtcSeconds: 0 },
    });
    close(r.apparent!.zenithDegrees, 50.11162, 0, 1e-5);
    close(r.azimuthDegrees, 194.34024, 0, 1e-5);
  });
  for (const n of siteNames) {
    it(`matches pvlib.get_solarposition for ${n}`, () => {
      for (const s of fixtures.sites[n].samples) {
        const p = sunPosition(s.epochMs, siteOf(n));
        close(p.zenith, s.zenith, 0, 0.002);
        close(p.apparentZenith, s.apparentZenith, 0, 0.002);
        close(p.azimuth, s.azimuth, 0, 0.005);
      }
    });
  }
  it("trace exposes zenith, apparent zenith and azimuth", () => {
    const t = createTracer();
    const p = sunPosition(Date.UTC(2025, 5, 21, 12), { lat: 40, lon: 0, altitude: 0 }, t);
    expect(traced(t, "sun.zenith")).toBe(p.zenith);
    expect(traced(t, "sun.apparentZenith")).toBe(p.apparentZenith);
    expect(traced(t, "sun.azimuth")).toBe(p.azimuth);
  });
});

describe("textbook approximation (learning aid)", () => {
  it("is within ~1° of SPA during daytime", () => {
    for (const n of siteNames) for (const s of fixtures.sites[n].samples) {
      close(textbookSun(s.epochMs, siteOf(n)).zenith, s.zenith, 0, 1.2);
    }
  });
  it("declination ≈ 0 at the equinox and ≈ +23.45 at the June solstice", () => {
    close(textbookSun(Date.UTC(2025, 2, 21, 12), { lat: 0, lon: 0, altitude: 0 }).declination, 0, 0, 1);
    close(textbookSun(Date.UTC(2025, 5, 21, 12), { lat: 0, lon: 0, altitude: 0 }).declination, 23.45, 0, 0.1);
  });
});

describe("solar position: fractional instants (regression)", () => {
  it("accepts a non-integer epoch (rounded to whole ms) instead of throwing", () => {
    const site = { lat: 38.71729, lon: 0.16168, altitude: 320 };
    const ms = Date.UTC(2025, 5, 21, 12) + 0.2;
    expect(() => sunPosition(ms, site)).not.toThrow();
    expect(sunPosition(ms, site).zenith).toBeCloseTo(sunPosition(Math.round(ms), site).zenith, 10);
  });
});
