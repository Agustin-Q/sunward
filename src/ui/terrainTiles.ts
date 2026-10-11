import type { ElevationSampler, LatLon } from "../core";

/**
 * Elevation from AWS Terrain Tiles (Mapzen "Terrarium" PNG encoding):
 *   elevation_m = R·256 + G + B/256 − 32768
 * Tiles are Web Mercator (slippy map) 256×256 px. Public, CORS-enabled, no rate limit.
 * https://registry.opendata.aws/terrain-tiles/
 */
export const TERRARIUM_URL = (z: number, x: number, y: number) =>
  `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const TILE_SIZE = 256;

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function encodeTerrarium(elevation: number): [number, number, number] {
  const v = Math.round((elevation + 32768) * 256) / 256;
  const r = Math.floor(v / 256);
  const g = Math.floor(v - r * 256);
  const b = Math.round((v - r * 256 - g) * 256);
  return [r, g, Math.min(255, b)];
}

/** Global pixel coordinates of a point at zoom z (Web Mercator). */
export function lonLatToPixel(p: LatLon, z: number): { px: number; py: number } {
  const n = TILE_SIZE * 2 ** z;
  const lat = Math.max(-85.05112878, Math.min(85.05112878, p.lat)) * (Math.PI / 180);
  const px = ((p.lon + 180) / 360) * n;
  const py = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
  return { px, py };
}

/** Ground resolution (m per pixel) at a latitude and zoom. */
export function metersPerPixel(lat: number, z: number): number {
  return (156_543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/**
 * Zoom level per sample by distance from the site: fine detail close in,
 * coarse far away (the angular error of a coarse cell shrinks with distance).
 */
export function zoomForDistance(distance: number): number {
  if (distance < 1_500) return 14; // ~7 m/px at 38°
  if (distance < 6_000) return 13;
  if (distance < 15_000) return 12;
  return 11; // ~60 m/px
}

export interface TileKey { z: number; x: number; y: number }
export const tileId = (t: TileKey) => `${t.z}/${t.x}/${t.y}`;

/** Elevation samples of one tile: Float32Array of 256×256, row-major. */
export type TileData = Float32Array;
export type TileFetcher = (t: TileKey, signal?: AbortSignal) => Promise<TileData>;

/** Bilinear elevation at global pixel (px, py), reading neighbouring tiles at edges. */
export function sampleBilinear(px: number, py: number, z: number, get: (t: TileKey) => TileData): number {
  const n = 2 ** z;
  const x0 = Math.floor(px - 0.5), y0 = Math.floor(py - 0.5);
  const fx = px - 0.5 - x0, fy = py - 0.5 - y0;
  const at = (gx: number, gy: number) => {
    const wx = ((gx % (n * TILE_SIZE)) + n * TILE_SIZE) % (n * TILE_SIZE);
    const cy = Math.max(0, Math.min(n * TILE_SIZE - 1, gy));
    const t = get({ z, x: Math.floor(wx / TILE_SIZE), y: Math.floor(cy / TILE_SIZE) });
    return t[(cy % TILE_SIZE) * TILE_SIZE + (wx % TILE_SIZE)];
  };
  return (
    at(x0, y0) * (1 - fx) * (1 - fy) + at(x0 + 1, y0) * fx * (1 - fy) +
    at(x0, y0 + 1) * (1 - fx) * fy + at(x0 + 1, y0 + 1) * fx * fy
  );
}

/** All tiles a set of (point, zoom) samples touches, including bilinear neighbours. */
export function tilesFor(samples: { p: LatLon; z: number }[]): TileKey[] {
  const seen = new Map<string, TileKey>();
  for (const { p, z } of samples) {
    const { px, py } = lonLatToPixel(p, z);
    const n = 2 ** z;
    for (const gx of [Math.floor(px - 0.5), Math.floor(px + 0.5)]) {
      for (const gy of [Math.floor(py - 0.5), Math.floor(py + 0.5)]) {
        const x = ((Math.floor(gx / TILE_SIZE) % n) + n) % n;
        const y = Math.max(0, Math.min(n - 1, Math.floor(gy / TILE_SIZE)));
        const k = { z, x, y };
        seen.set(tileId(k), k);
      }
    }
  }
  return [...seen.values()];
}

export interface TileSamplerOptions {
  fetchTile: TileFetcher;
  /** The site; sample zoom depends on distance from it. */
  site: LatLon;
  concurrency?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
  distanceOf?: (a: LatLon, b: LatLon) => number;
}

const haversine = (a: LatLon, b: LatLon) => {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
};

/** ElevationSampler backed by terrain tiles. */
export function tileSampler(opts: TileSamplerOptions): ElevationSampler {
  const dist = opts.distanceOf ?? haversine;
  return async (points) => {
    const samples = points.map((p) => ({ p, z: zoomForDistance(dist(opts.site, p)) }));
    const needed = tilesFor(samples);
    const cache = new Map<string, TileData>();
    let next = 0, done = 0;
    const worker = async () => {
      while (next < needed.length) {
        const t = needed[next++];
        cache.set(tileId(t), await opts.fetchTile(t, opts.signal));
        opts.onProgress?.(++done, needed.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(opts.concurrency ?? 6, needed.length) }, worker));
    const get = (t: TileKey) => {
      const d = cache.get(tileId(t));
      if (!d) throw new Error(`tile ${tileId(t)} missing`);
      return d;
    };
    return samples.map(({ p, z }) => {
      const { px, py } = lonLatToPixel(p, z);
      return sampleBilinear(px, py, z, get);
    });
  };
}

/** Decode Terrarium RGBA pixels into elevations. */
export function decodeTerrariumRGBA(rgba: Uint8ClampedArray | Uint8Array): TileData {
  const out = new Float32Array(TILE_SIZE * TILE_SIZE);
  for (let i = 0; i < out.length; i++) out[i] = decodeTerrarium(rgba[4 * i], rgba[4 * i + 1], rgba[4 * i + 2]);
  return out;
}

/** Browser tile fetcher: fetch PNG → ImageBitmap → canvas pixels → elevations. Retries twice. */
export function browserTileFetcher(fetchFn: typeof fetch = fetch.bind(globalThis)): TileFetcher {
  return async (t, signal) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const r = await fetchFn(TERRARIUM_URL(t.z, t.x, t.y), { signal, mode: "cors" });
        if (!r.ok) throw new Error(`terrain tile ${tileId(t)}: HTTP ${r.status}`);
        const bmp = await createImageBitmap(await r.blob(), { colorSpaceConversion: "none", premultiplyAlpha: "none" });
        const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(TILE_SIZE, TILE_SIZE) : Object.assign(document.createElement("canvas"), { width: TILE_SIZE, height: TILE_SIZE });
        const ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
        ctx.drawImage(bmp, 0, 0);
        bmp.close?.();
        return decodeTerrariumRGBA(ctx.getImageData(0, 0, TILE_SIZE, TILE_SIZE).data);
      } catch (e) {
        if ((e as Error).name === "AbortError" || attempt >= 2) throw e;
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
      }
    }
  };
}
