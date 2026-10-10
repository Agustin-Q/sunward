import { clearSkyHour, clearSkySource, getSource, WEATHER_SOURCES, HOURS_PER_YEAR } from "../weather";
import { createTracer, traced } from "../trace";
import { fixtures, siteNames, siteOf, params, close, yearFor } from "./helpers";

describe("clear-sky hourly inputs (vs pvlib end-to-end)", () => {
  for (const n of siteNames) {
    it(`${n}: air mass, I₀, GHI, DNI, DHI`, () => {
      for (const s of fixtures.sites[n].samples) {
        const t = createTracer();
        const h = clearSkyHour(siteOf(n), params, s.epochMs, t);
        close(h.dniExtra, s.dniExtra, 1e-9);
        close(traced(t, "atm.airmassRelative"), s.airmassRelative, 2e-4);
        close(traced(t, "atm.airmassAbsolute"), s.airmassAbsolute, 2e-4);
        // tiny SPA ΔT differences propagate; 0.2 % or 0.5 W/m²
        close(h.irr.ghi, s.ghi, 2e-3, 0.5);
        close(h.irr.dni, s.dni, 2e-3, 0.5);
        close(h.irr.dhi, s.dhi, 2e-3, 0.5);
      }
    });
  }
});

describe("weather year", () => {
  it("has 8760 hourly steps at hh:30 UTC, months 0–11", async () => {
    const y = await yearFor("madrid");
    expect(y.epochMs.length).toBe(HOURS_PER_YEAR);
    expect(new Date(y.epochMs[0]).toISOString()).toBe("2025-01-01T00:30:00.000Z");
    expect(y.month[0]).toBe(0);
    expect(y.month[HOURS_PER_YEAR - 1]).toBe(11);
    expect(Math.max(...y.ghi)).toBeGreaterThan(900);
    expect(Math.min(...y.ghi)).toBe(0);
  });
  it("source registry: clear sky available, others listed but disabled", () => {
    expect(getSource("clearsky")).toBe(clearSkySource);
    expect(WEATHER_SOURCES.filter((s) => s.available).map((s) => s.id)).toEqual(["clearsky"]);
    expect(WEATHER_SOURCES.map((s) => s.id)).toContain("pvgis");
    expect(() => getSource("nope")).toThrow();
  });
  it("unavailable sources reject clearly", async () => {
    await expect(getSource("pvgis").year(siteOf("madrid"), params)).rejects.toThrow(/not available/);
  });
});
