import { NASA_POWER_YEARS, averageYears, decodeSeries, encodeSeries, parseNasaPower, type HourlySeries, type YearArrays } from "../core";

export const NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/hourly/point";
const PARAMS = "ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF";

export function nasaPowerUrl(lat: number, lon: number, year: number): string {
  const q = new URLSearchParams({
    parameters: PARAMS,
    community: "RE",
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    start: `${year}0101`,
    end: `${year}1231`,
    format: "JSON",
    "time-standard": "UTC",
  });
  return `${NASA_POWER_URL}?${q}`;
}

/** NASA POWER's solar data is on a 1° grid: cache per 0.1° so nearby clicks reuse it. */
export const nasaCacheKey = (lat: number, lon: number) => `sunward.nasa.v1.${lat.toFixed(1)},${lon.toFixed(1)}`;

export function readCachedSeries(lat: number, lon: number): HourlySeries | null {
  try {
    const raw = localStorage.getItem(nasaCacheKey(lat, lon));
    return raw ? decodeSeries(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function writeCachedSeries(lat: number, lon: number, s: HourlySeries): void {
  try { localStorage.setItem(nasaCacheKey(lat, lon), JSON.stringify(encodeSeries(s))); } catch { /* storage full */ }
}

export interface NasaOptions {
  fetchFn?: typeof fetch;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  years?: number[];
}

/**
 * Download NASA POWER hourly sunlight (one request per year, in sequence) and
 * average the years. Runs in the browser; no server involved.
 */
export async function fetchNasaPower(lat: number, lon: number, opts: NasaOptions = {}): Promise<HourlySeries> {
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  const years = opts.years ?? NASA_POWER_YEARS;
  const got: YearArrays[] = [];
  for (const [i, y] of years.entries()) {
    let r: Response;
    try {
      r = await fetchFn(nasaPowerUrl(lat, lon, y), { signal: opts.signal });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new Error(`NASA POWER could not be reached from this browser (${(e as Error).message})`);
    }
    if (!r.ok) {
      let detail = "";
      try { detail = JSON.stringify(await r.json()).slice(0, 200); } catch { /* not JSON */ }
      throw new Error(`NASA POWER answered HTTP ${r.status} for ${y}${detail ? `: ${detail}` : ""}`);
    }
    got.push(parseNasaPower(await r.json(), y));
    opts.onProgress?.(i + 1, years.length);
  }
  const first = years[0], last = years[years.length - 1];
  return averageYears(got, `NASA POWER ${first}${last !== first ? `–${last}` : ""} mean`);
}
