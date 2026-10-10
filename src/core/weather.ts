import { absoluteAirmass, altitudeToPressure, relativeAirmass } from "./atmosphere";
import { ineichen, type Irradiance } from "./clearsky";
import { extraterrestrialAt } from "./extraterrestrial";
import { sunPosition, type SunPosition } from "./solarPosition";
import type { Tracer } from "./trace";
import type { ModelParams, Site } from "./types";

/** Reference year: non-leap, 8760 hourly steps centred on hh:30 UTC. */
export const REFERENCE_YEAR = 2025;
export const HOURS_PER_YEAR = 8760;
export const yearStartMs = Date.UTC(REFERENCE_YEAR, 0, 1);
export const hourEpoch = (i: number) => yearStartMs + i * 3_600_000 + 1_800_000;

/** One hour of inputs for the plane-of-array model. */
export interface HourInputs {
  sun: SunPosition;
  irr: Irradiance;
  dniExtra: number;
}

/** A full year of hourly inputs, as typed arrays (fast inner loops). */
export interface WeatherYear {
  sourceId: string;
  site: Site;
  epochMs: Float64Array;
  /** 0–11, UTC month */
  month: Uint8Array;
  apparentZenith: Float64Array;
  azimuth: Float64Array;
  ghi: Float64Array;
  dni: Float64Array;
  dhi: Float64Array;
  dniExtra: Float64Array;
}

/**
 * A pluggable source of hourly sunlight data. Real-weather sources (PVGIS,
 * NASA POWER) implement the same interface later; the rest of the model
 * does not change.
 */
export interface WeatherSource {
  id: string;
  label: string;
  description: string;
  available: boolean;
  /** Inputs for one hour, with an optional trace of how they were derived. */
  hour(site: Site, params: ModelParams, epochMs: number, t?: Tracer): Promise<HourInputs> | HourInputs;
  /** The whole reference year. */
  year(site: Site, params: ModelParams): Promise<WeatherYear>;
}

/** Clear-sky hour: SPA sun position → air mass → Ineichen. Pure and synchronous. */
export function clearSkyHour(site: Site, params: ModelParams, epochMs: number, t?: Tracer): HourInputs {
  t?.group("Atmosphere");
  const p = altitudeToPressure(site.altitude, t);
  t?.group("Sun position");
  const sun = sunPosition(epochMs, site, t, p);
  t?.group("Top of atmosphere");
  const dniExtra = extraterrestrialAt(epochMs, t);
  t?.group("Atmosphere");
  const amr = relativeAirmass(sun.apparentZenith, t);
  const ama = absoluteAirmass(amr, p, t);
  t?.group("Clear sky (Ineichen)");
  t?.add({ key: "clearsky.tl", label: "Linke turbidity (input)", symbol: "TL", formula: "", substituted: "user setting", value: params.linkeTurbidity, unit: "–" });
  const irr = ineichen(sun.apparentZenith, ama, params.linkeTurbidity, site.altitude, dniExtra, t);
  return { sun, irr, dniExtra };
}

export function buildYear(sourceId: string, site: Site, hourFn: (epochMs: number) => HourInputs): WeatherYear {
  const n = HOURS_PER_YEAR;
  const y: WeatherYear = {
    sourceId,
    site,
    epochMs: new Float64Array(n),
    month: new Uint8Array(n),
    apparentZenith: new Float64Array(n),
    azimuth: new Float64Array(n),
    ghi: new Float64Array(n),
    dni: new Float64Array(n),
    dhi: new Float64Array(n),
    dniExtra: new Float64Array(n),
  };
  for (let i = 0; i < n; i++) {
    const ms = hourEpoch(i);
    const h = hourFn(ms);
    y.epochMs[i] = ms;
    y.month[i] = new Date(ms).getUTCMonth();
    y.apparentZenith[i] = h.sun.apparentZenith;
    y.azimuth[i] = h.sun.azimuth;
    y.ghi[i] = h.irr.ghi;
    y.dni[i] = h.irr.dni;
    y.dhi[i] = h.irr.dhi;
    y.dniExtra[i] = h.dniExtra;
  }
  return y;
}

export const clearSkySource: WeatherSource = {
  id: "clearsky",
  label: "Clear sky (offline)",
  description: "Ineichen clear-sky model, no clouds. Overestimates real totals; relative losses are reliable.",
  available: true,
  hour: clearSkyHour,
  async year(site, params) {
    return buildYear("clearsky", site, (ms) => clearSkyHour(site, params, ms));
  },
};

const unavailable = (id: string, label: string, description: string): WeatherSource => ({
  id,
  label,
  description,
  available: false,
  hour() {
    throw new Error(`${label} is not available yet`);
  },
  async year() {
    throw new Error(`${label} is not available yet`);
  },
});

export const WEATHER_SOURCES: WeatherSource[] = [
  clearSkySource,
  unavailable("pvgis", "PVGIS typical year (coming soon)", "EU JRC typical meteorological year — real clouds."),
  unavailable("nasa-power", "NASA POWER (coming soon)", "Global satellite-derived climatology."),
];

export function getSource(id: string): WeatherSource {
  const s = WEATHER_SOURCES.find((x) => x.id === id);
  if (!s) throw new Error(`unknown weather source: ${id}`);
  return s;
}

