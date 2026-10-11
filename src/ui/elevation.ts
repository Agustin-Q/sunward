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
  /** Called when the service asks us to slow down (HTTP 429), with the wait in ms. */
  onWait?: (ms: number) => void;
  signal?: AbortSignal;
  /** Base wait before retrying a failed request, ms */
  retryDelayMs?: number;
  /** Retries per request on 429 / 5xx */
  maxRetries?: number;
  sleep?: (ms: number) => Promise<void>;
}

/** Wait from a Retry-After header (seconds or HTTP date), else the fallback. */
export function retryAfterMs(header: string | null, fallbackMs: number, now = Date.now()): number {
  if (!header) return fallbackMs;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, 120_000);
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.min(Math.max(0, t - now), 120_000) : fallbackMs;
}

/**
 * Elevation sampler backed by the Open-Meteo elevation API (Copernicus GLO-90).
 * Backup source only: the free tier allows 600 calls per minute and appears to count
 * each coordinate, so a full horizon (~1,700 points) is throttled. Requests go one at a
 * time by default and wait when the service answers 429 (Retry-After, else 20 s, 40 s, …).
 */
export function openMeteoSampler(opts: SamplerOptions = {}): ElevationSampler {
  const fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
  const concurrency = opts.concurrency ?? 1;
  const retryDelay = opts.retryDelayMs ?? 20_000;
  const maxRetries = opts.maxRetries ?? 6;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((res, rej) => {
    const id = setTimeout(res, ms);
    opts.signal?.addEventListener("abort", () => { clearTimeout(id); rej(new DOMException("aborted", "AbortError")); }, { once: true });
  }));
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
        // 429 = slow down: wait and retry up to maxRetries; 5xx = server trouble: retry twice quickly
        const limit = r.status === 429 ? maxRetries : r.status >= 500 ? Math.min(2, maxRetries) : 0;
        if (attempt >= limit) throw new Error(`elevation service error ${r.status}`);
        const wait = r.status === 429 ? retryAfterMs(r.headers.get("retry-after"), retryDelay * (attempt + 1)) : Math.min(retryDelay, 2000) * (attempt + 1);
        opts.onWait?.(wait);
        await sleep(wait);
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
