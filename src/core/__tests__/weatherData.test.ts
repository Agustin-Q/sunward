import fx from "../__fixtures__/weather.json";
import {
  HOURS_PER_YEAR, averageYears, decodeSeries, encodeSeries, hourEpoch, hourOfYear, indexOfEpoch, optimize, parseNasaPower,
  seriesHour, seriesSource, simulateYear, type HourlySeries, type ModelParams,
} from "..";
import { createTracer, traced } from "../trace";
import { close } from "./helpers";

const params: ModelParams = { linkeTurbidity: 3, albedo: fx.meta.albedo, transposition: "haydavies" };
type Key = keyof typeof fx.sites;
const series = (k: Key): HourlySeries => ({
  ghi: Float32Array.from(fx.sites[k].ghi), dni: Float32Array.from(fx.sites[k].dni), dhi: Float32Array.from(fx.sites[k].dhi), missing: 0, label: "test data",
});
const siteOf = (k: Key) => ({ lat: fx.sites[k].lat, lon: fx.sites[k].lon, altitude: fx.sites[k].alt });

/** A tiny NASA POWER response in the documented shape. */
function nasaJson(year: number, entries: Record<string, [number, number, number]>, fill = -999) {
  const p: Record<string, Record<string, number>> = { ALLSKY_SFC_SW_DWN: {}, ALLSKY_SFC_SW_DNI: {}, ALLSKY_SFC_SW_DIFF: {} };
  for (const [stamp, [g, b, d]] of Object.entries(entries)) {
    p.ALLSKY_SFC_SW_DWN[stamp] = g; p.ALLSKY_SFC_SW_DNI[stamp] = b; p.ALLSKY_SFC_SW_DIFF[stamp] = d;
  }
  return { type: "Feature", header: { fill_value: fill, start: `${year}0101`, end: `${year}1231` }, properties: { parameter: p } };
}

describe("hour indexing", () => {
  it("maps dates to hours of a 365-day year, skipping Feb 29", () => {
    expect(hourOfYear(2023, 1, 1, 0)).toBe(0);
    expect(hourOfYear(2023, 12, 31, 23)).toBe(8759);
    expect(hourOfYear(2020, 3, 1, 0)).toBe(59 * 24); // leap year: Mar 1 lines up with non-leap years
    expect(hourOfYear(2020, 2, 29, 12)).toBe(-1);
  });
  it("model epochs (hh:30) map to the hour that contains them", () => {
    expect(indexOfEpoch(hourEpoch(0))).toBe(0);
    expect(indexOfEpoch(hourEpoch(4321))).toBe(4321);
  });
});

describe("NASA POWER parsing", () => {
  it("reads the three irradiance parameters keyed YYYYMMDDHH (UTC, interval start)", () => {
    const y = parseNasaPower(nasaJson(2023, { "2023062112": [950, 880, 110], "2023010100": [0, 0, 0] }), 2023);
    const i = hourOfYear(2023, 6, 21, 12);
    expect([y.ghi[i], y.dni[i], y.dhi[i]]).toEqual([950, 880, 110]);
    expect(y.ghi[0]).toBe(0);
    expect(Number.isNaN(y.ghi[1])).toBe(true); // not in the answer → missing
  });
  it("treats the fill value and negatives as missing, ignores other years and Feb 29", () => {
    const y = parseNasaPower(nasaJson(2020, { "2020050112": [-999, 500, -1], "2019050112": [1, 1, 1], "2020022912": [5, 5, 5] }), 2020);
    const i = hourOfYear(2020, 5, 1, 12);
    expect(Number.isNaN(y.ghi[i])).toBe(true);
    expect(y.dni[i]).toBe(500);
    expect(Number.isNaN(y.dhi[i])).toBe(true);
    expect(y.ghi.filter((v) => Number.isFinite(v)).length).toBe(0);
  });
  it("rejects an answer without irradiance", () => {
    expect(() => parseNasaPower({ properties: { parameter: { T2M: {} } } }, 2023)).toThrow(/missing irradiance/);
    expect(() => parseNasaPower(null, 2023)).toThrow();
  });
});

describe("multi-year mean", () => {
  it("averages per hour, skipping missing values, and counts hours missing everywhere", () => {
    const a = parseNasaPower(nasaJson(2022, { "2022062112": [900, 800, 100] }), 2022);
    const b = parseNasaPower(nasaJson(2023, { "2023062112": [700, 400, 300], "2023062113": [600, 300, 250] }), 2023);
    const m = averageYears([a, b], "test");
    const i = hourOfYear(2023, 6, 21, 12);
    expect([m.ghi[i], m.dni[i], m.dhi[i]]).toEqual([800, 600, 200]);
    expect(m.ghi[i + 1]).toBe(600); // only one year had it
    expect(m.missing).toBe(HOURS_PER_YEAR - 2);
    expect(() => averageYears([], "x")).toThrow();
  });
});

describe("series storage", () => {
  it("round-trips through the compact cache encoding (integer W/m²)", () => {
    const s = series("alicante");
    const back = decodeSeries(JSON.parse(JSON.stringify(encodeSeries(s))));
    expect(Array.from(back.ghi)).toEqual(Array.from(s.ghi));
    expect(back.label).toBe("test data");
    expect(() => decodeSeries({ ...encodeSeries(s), ghi: btoa("short") })).toThrow(/wrong length/);
  });
});

describe("real-weather pipeline vs pvlib (mandatory sites)", () => {
  for (const k of ["alicante", "buenosAires"] as Key[]) {
    it(`${k}: monthly and annual POA from data match pvlib`, async () => {
      const w = await seriesSource("nasa-power", "NASA", "", series(k)).year(siteOf(k), params);
      for (const y of fx.sites[k].yearly) {
        const r = simulateYear(w, { tilt: y.tilt, azimuth: y.azimuth }, params);
        close(r.annual, y.annual, 2e-3);
        r.monthly.forEach((m, i) => close(m, y.monthly[i], 4e-3, 0.1));
      }
    });
    it(`${k}: clouds lower the totals well below clear sky, and the optimum still faces the equator`, async () => {
      const w = await seriesSource("nasa-power", "NASA", "", series(k)).year(siteOf(k), params);
      expect(fx.sites[k].dataGhiAnnual).toBeLessThan(0.75 * fx.sites[k].clearSkyGhiAnnual);
      const opt = optimize(w, params);
      const eq = fx.sites[k].lat >= 0 ? 180 : 0;
      expect(Math.abs(((opt.best.azimuth - eq + 540) % 360) - 180)).toBeLessThanOrEqual(15);
    }, 30_000);
  }
});

describe("seriesHour", () => {
  const s = series("alicante");
  const site = siteOf("alicante");
  it("uses the data by day, zero at night, and traces the source and a closure check", () => {
    const noon = hourEpoch(hourOfYear(2025, 6, 21, 12));
    const t = createTracer();
    const h = seriesHour(site, s, noon, t);
    expect(h.irr.ghi).toBe(s.ghi[indexOfEpoch(noon)]);
    expect(traced(t, "data.ghi")).toBe(h.irr.ghi);
    expect(t.steps.some((x) => x.group.startsWith("Weather data"))).toBe(true);
    close(traced(t, "data.closure"), h.irr.ghi, 0.05, 5);
    const night = seriesHour(site, { ...s, ghi: s.ghi.map(() => 50) }, hourEpoch(hourOfYear(2025, 6, 21, 0)));
    expect(night.irr).toEqual({ ghi: 0, dni: 0, dhi: 0 });
  });
});
