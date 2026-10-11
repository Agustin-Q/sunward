import { extraterrestrialAt } from "./extraterrestrial";
import { altitudeToPressure } from "./atmosphere";
import { sunPosition } from "./solarPosition";
import { fmt as f, type Tracer } from "./trace";
import type { ModelParams, Site } from "./types";
import { HOURS_PER_YEAR, buildYear, yearStartMs, type HourInputs, type WeatherSource } from "./weather";

/**
 * Measured / satellite-derived hourly sunlight for the reference year.
 * Index i is the hour starting at Jan 1 00:00 UTC + i h (value = mean over that hour),
 * matched to the model step at hh:30 UTC. Feb 29 is dropped.
 */
export interface HourlySeries {
  ghi: Float32Array;
  dni: Float32Array;
  dhi: Float32Array;
  /** Hours with no valid data in any source year (filled with 0) */
  missing: number;
  /** Human-readable origin, e.g. "NASA POWER 2019–2023 mean" */
  label: string;
}

/** Hour-of-year index (0–8759) for a UTC date in any year, skipping Feb 29; -1 for Feb 29. */
export function hourOfYear(year: number, month: number, day: number, hour: number): number {
  if (month === 2 && day === 29) return -1;
  const ms = Date.UTC(2025, month - 1, day, hour) - Date.UTC(2025, 0, 1);
  void year;
  return Math.round(ms / 3_600_000);
}

export interface YearArrays {
  year: number;
  ghi: Float64Array;
  dni: Float64Array;
  dhi: Float64Array;
}

/**
 * Parse a NASA POWER hourly point response (JSON, time-standard=UTC):
 *   { header: { fill_value }, properties: { parameter: { ALLSKY_SFC_SW_DWN: { "YYYYMMDDHH": v } , … } } }
 * Keys are the start of each hour (pvlib: "index corresponds to the start of the interval").
 * Fill values and negatives become NaN.
 */
export function parseNasaPower(json: unknown, year: number): YearArrays {
  const j = json as { header?: { fill_value?: number }; properties?: { parameter?: Record<string, Record<string, number>> } };
  const p = j?.properties?.parameter;
  const need = ["ALLSKY_SFC_SW_DWN", "ALLSKY_SFC_SW_DNI", "ALLSKY_SFC_SW_DIFF"];
  if (!p || need.some((k) => !p[k] || typeof p[k] !== "object")) throw new Error("NASA POWER answer is missing irradiance data");
  const fill = j.header?.fill_value ?? -999;
  const mk = () => new Float64Array(HOURS_PER_YEAR).fill(NaN);
  const out: YearArrays = { year, ghi: mk(), dni: mk(), dhi: mk() };
  const targets: [string, Float64Array][] = [["ALLSKY_SFC_SW_DWN", out.ghi], ["ALLSKY_SFC_SW_DNI", out.dni], ["ALLSKY_SFC_SW_DIFF", out.dhi]];
  for (const [key, arr] of targets) {
    for (const [stamp, raw] of Object.entries(p[key])) {
      if (!/^\d{10}$/.test(stamp) || Number(stamp.slice(0, 4)) !== year) continue;
      const i = hourOfYear(year, Number(stamp.slice(4, 6)), Number(stamp.slice(6, 8)), Number(stamp.slice(8, 10)));
      if (i < 0 || i >= HOURS_PER_YEAR) continue;
      const v = Number(raw);
      arr[i] = !Number.isFinite(v) || v === fill || v < 0 ? NaN : v;
    }
  }
  return out;
}

/** Per-hour mean over several years, ignoring missing values. */
export function averageYears(years: YearArrays[], label: string): HourlySeries {
  if (years.length === 0) throw new Error("no weather years to average");
  const res = { ghi: new Float32Array(HOURS_PER_YEAR), dni: new Float32Array(HOURS_PER_YEAR), dhi: new Float32Array(HOURS_PER_YEAR) };
  let missing = 0;
  for (let i = 0; i < HOURS_PER_YEAR; i++) {
    let any = false;
    for (const k of ["ghi", "dni", "dhi"] as const) {
      let s = 0, n = 0;
      for (const y of years) {
        const v = y[k][i];
        if (Number.isFinite(v)) { s += v; n++; }
      }
      res[k][i] = n ? s / n : 0;
      if (n) any = true;
    }
    if (!any) missing++;
  }
  return { ...res, missing, label };
}

/** Hour index of a model epoch (hh:30 UTC in the reference year). */
export const indexOfEpoch = (epochMs: number) => Math.floor((epochMs - yearStartMs) / 3_600_000);

/**
 * One hour from a data series: SPA sun position, Spencer I₀, irradiance from the data.
 * When the sun is below the horizon the irradiance is set to 0 (data at dawn/dusk can
 * be non-zero because it is an hourly mean); negatives are clipped to 0.
 */
export function seriesHour(site: Site, series: HourlySeries, epochMs: number, t?: Tracer): HourInputs {
  t?.group("Atmosphere");
  const p = altitudeToPressure(site.altitude, t);
  t?.group("Sun position");
  const sun = sunPosition(epochMs, site, t, p);
  t?.group("Top of atmosphere");
  const dniExtra = extraterrestrialAt(epochMs, t);
  const i = indexOfEpoch(epochMs);
  const up = sun.apparentZenith < 90;
  const raw = { ghi: series.ghi[i] ?? 0, dni: series.dni[i] ?? 0, dhi: series.dhi[i] ?? 0 };
  const irr = up ? { ghi: Math.max(0, raw.ghi), dni: Math.max(0, raw.dni), dhi: Math.max(0, raw.dhi) } : { ghi: 0, dni: 0, dhi: 0 };
  if (t) {
    t.group(`Weather data (${series.label})`);
    const src = `${series.label}, hour ${i} of the year`;
    t.add({ key: "data.ghi", label: "Global horizontal (data)", symbol: "GHI", formula: "", substituted: up ? src : `${src}; sun below horizon → 0 (data ${f(raw.ghi, 1)})`, value: irr.ghi, unit: "W/m²" });
    t.add({ key: "data.dni", label: "Direct normal (data)", symbol: "DNI", formula: "", substituted: up ? src : "sun below horizon → 0", value: irr.dni, unit: "W/m²" });
    t.add({ key: "data.dhi", label: "Diffuse horizontal (data)", symbol: "DHI", formula: "", substituted: up ? src : "sun below horizon → 0", value: irr.dhi, unit: "W/m²" });
    const cz = Math.max(0, Math.cos((sun.apparentZenith * Math.PI) / 180));
    t.add({ key: "data.closure", label: "Closure check: DNI·cos θz′ + DHI", symbol: "≈GHI", formula: "DNI · cos θz′ + DHI", substituted: `${f(irr.dni, 1)} · ${f(cz)} + ${f(irr.dhi, 1)} (data GHI ${f(irr.ghi, 1)})`, value: irr.dni * cz + irr.dhi, unit: "W/m²" });
  }
  return { sun, irr, dniExtra };
}

/** A WeatherSource backed by a loaded data series. */
export function seriesSource(id: string, label: string, description: string, series: HourlySeries): WeatherSource {
  return {
    id,
    label,
    description,
    available: true,
    hour: (site: Site, _params: ModelParams, epochMs: number, t?: Tracer) => seriesHour(site, series, epochMs, t),
    async year(site: Site) {
      return buildYear(id, site, (ms) => seriesHour(site, series, ms));
    },
  };
}

// ---- compact storage: W/m² rounded to integers, base64 Int16 (for caches and workers) ----

export function encodeSeries(s: HourlySeries): { ghi: string; dni: string; dhi: string; missing: number; label: string } {
  const enc = (a: Float32Array) => {
    const i16 = new Int16Array(a.length);
    for (let k = 0; k < a.length; k++) i16[k] = Math.max(-32768, Math.min(32767, Math.round(a[k])));
    const bytes = new Uint8Array(i16.buffer);
    let bin = "";
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode(...bytes.subarray(k, k + 0x8000));
    return btoa(bin);
  };
  return { ghi: enc(s.ghi), dni: enc(s.dni), dhi: enc(s.dhi), missing: s.missing, label: s.label };
}

export function decodeSeries(o: { ghi: string; dni: string; dhi: string; missing: number; label: string }): HourlySeries {
  const dec = (b64: string) => {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
    if (bytes.length !== HOURS_PER_YEAR * 2) throw new Error("stored weather series has the wrong length");
    return Float32Array.from(new Int16Array(bytes.buffer));
  };
  return { ghi: dec(o.ghi), dni: dec(o.dni), dhi: dec(o.dhi), missing: o.missing, label: o.label };
}
