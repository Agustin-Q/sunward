import type { ElevationSampler, LatLon } from "../core";

export const OPEN_METEO_ELEVATION = "https://api.open-meteo.com/v1/elevation";
/** Open-Meteo accepts up to 100 coordinates per request. */
export const MAX_POINTS_PER_REQUEST = 100;

export function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

export function elevationUrl(points: LatLon[], base = OPEN_METEO_ELEVATION): string {
  const r = (x: number) => x.toFixed(5);
  return `${base}?latitude=${points.map((p) => r(p.lat)).join(",")}&longitude=${points.map((p) => r(p.lon)).join(",")}`;
}

export interface SamplerOptions {
  fetchFn?: typeof fetch;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
  /** Wait before retrying a rate-limited request, ms */
  retryDelayMs?: number;
}

/**
 * Elevation sampler backed by the Open-Meteo elevation API (Copernicus GLO-90).
 * Splits points into requests of 100, runs a few at a time, retries a
 * rate-limited (429) or failed request twice.
 */
export function openMeteoSampler(opts: SamplerOptions = {}): ElevationSampler {
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  const concurrency = opts.concurrency ?? 3;
  const retryDelay = opts.retryDelayMs ?? 1200;
  return async (points) => {
    const batches = chunk(points, MAX_POINTS_PER_REQUEST);
    const results: number[][] = new Array(batches.length);
    let next = 0, done = 0;
    const getBatch = async (i: number) => {
      for (let attempt = 0; ; attempt++) {
        const r = await fetchFn(elevationUrl(batches[i]), { signal: opts.signal });
        if (r.ok) {
          const j = await r.json();
          const e = j?.elevation;
          if (!Array.isArray(e) || e.length !== batches[i].length) throw new Error("elevation service returned an unexpected answer");
          return e.map(Number);
        }
        if (attempt >= 2 || (r.status !== 429 && r.status < 500)) throw new Error(`elevation service error ${r.status}`);
        await new Promise((res) => setTimeout(res, retryDelay * (attempt + 1)));
      }
    };
    const worker = async () => {
      while (next < batches.length) {
        const i = next++;
        results[i] = await getBatch(i);
        opts.onProgress?.(++done, batches.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
    return results.flat();
  };
}
