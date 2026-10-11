import { computeHorizon, destination, distanceBetween, elevationAngle, type LatLon } from "../core";
import {
  TILE_SIZE, decodeTerrarium, decodeTerrariumRGBA, encodeTerrarium, lonLatToPixel, metersPerPixel, sampleBilinear,
  tileSampler, tilesFor, zoomForDistance, type TileKey,
} from "./terrainTiles";

/** Inverse Web Mercator: global pixel centre → lat/lon. */
const pixelToLonLat = (px: number, py: number, z: number): LatLon => {
  const n = TILE_SIZE * 2 ** z;
  return { lon: (px / n) * 360 - 180, lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * py) / n))) * 180) / Math.PI };
};

/** Synthetic tile fetcher: fills each pixel from an elevation function (through the Terrarium RGB round trip). */
const fakeFetcher = (elev: (p: LatLon) => number) => {
  const fetched: string[] = [];
  const fetchTile = async (t: TileKey) => {
    fetched.push(`${t.z}/${t.x}/${t.y}`);
    const rgba = new Uint8Array(TILE_SIZE * TILE_SIZE * 4);
    for (let j = 0; j < TILE_SIZE; j++) for (let i = 0; i < TILE_SIZE; i++) {
      const p = pixelToLonLat(t.x * TILE_SIZE + i + 0.5, t.y * TILE_SIZE + j + 0.5, t.z);
      const [r, g, b] = encodeTerrarium(elev(p));
      rgba.set([r, g, b, 255], 4 * (j * TILE_SIZE + i));
    }
    return decodeTerrariumRGBA(rgba);
  };
  return { fetchTile, fetched };
};

describe("Terrarium encoding", () => {
  it("decodes the documented formula and round-trips to 1/256 m", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(129, 44, 128)).toBe(300.5);
    for (const e of [-430, 0, 12.34, 667, 4807.9, 8848]) expect(Math.abs(decodeTerrarium(...encodeTerrarium(e)) - e)).toBeLessThanOrEqual(1 / 256);
  });
});

describe("Web Mercator tile maths", () => {
  it("matches known slippy-map tiles", () => {
    // reference tiles from the OSM wiki formula x = ⌊(λ+180)/360·2^z⌋, y = ⌊(1 − asinh(tan φ)/π)/2·2^z⌋
    const tile = (lat: number, lon: number, z: number) => {
      const { px, py } = lonLatToPixel({ lat, lon }, z);
      return [Math.floor(px / 256), Math.floor(py / 256)];
    };
    expect(tile(40.4168, -3.7038, 11)).toEqual([1002, 772]); // Madrid
    expect(tile(51.5074, -0.1278, 10)).toEqual([511, 340]); // London
    const o = lonLatToPixel({ lat: 0, lon: 0 }, 0);
    expect(o).toEqual({ px: 128, py: 128 });
  });
  it("pixel ↔ lat/lon round trip", () => {
    const p = { lat: 38.72019, lon: 0.16496 };
    const { px, py } = lonLatToPixel(p, 14);
    const q = pixelToLonLat(px, py, 14);
    expect(q.lat).toBeCloseTo(p.lat, 9);
    expect(q.lon).toBeCloseTo(p.lon, 9);
  });
  it("resolution and zoom choice", () => {
    expect(metersPerPixel(0, 0)).toBeCloseTo(156543.03, 1);
    expect(metersPerPixel(38.7, 11)).toBeCloseTo(59.6, 0);
    expect([100, 3000, 10_000, 30_000].map(zoomForDistance)).toEqual([14, 13, 12, 11]);
  });
  it("tilesFor dedupes and includes bilinear neighbours", () => {
    const tiles = tilesFor([{ p: { lat: 38.72, lon: 0.165 }, z: 14 }, { p: { lat: 38.72, lon: 0.165 }, z: 14 }]);
    expect(tiles.length).toBeGreaterThanOrEqual(1);
    expect(tiles.length).toBeLessThanOrEqual(4);
  });
});

describe("tile sampler", () => {
  const site = { lat: 38.72019, lon: 0.16496 };
  const plane = (p: LatLon) => 300 + 2000 * (p.lat - site.lat) + 1000 * (p.lon - site.lon); // smooth slope

  it("bilinear sampling reproduces a smooth surface across tile edges", async () => {
    const { fetchTile } = fakeFetcher(plane);
    const pts = [0, 45, 90, 135, 180, 225, 270, 315].flatMap((b) => [200, 2_000, 9_000, 25_000].map((d) => destination(site, b, d)));
    const z = await tileSampler({ fetchTile, site })(pts);
    pts.forEach((p, i) => expect(Math.abs(z[i] - plane(p))).toBeLessThan(0.05));
  });

  it("downloads a modest number of tiles for a full 72 × 24 horizon", async () => {
    const { fetchTile, fetched } = fakeFetcher(() => 300);
    const progress: number[] = [];
    await computeHorizon(site, 0, tileSampler({ fetchTile, site, onProgress: (d) => progress.push(d) }));
    expect(fetched.length).toBeGreaterThan(10);
    expect(fetched.length).toBeLessThan(80);
    expect(new Set(fetched).size).toBe(fetched.length); // each tile once
    expect(progress.at(-1)).toBe(fetched.length);
  }, 60_000);

  it("end to end: a hill 5 km south gives the expected horizon angle", async () => {
    const peak = destination(site, 180, 5000);
    const hill = (p: LatLon) => 300 + 800 * Math.exp(-((distanceBetween(peak, p) / 1500) ** 2));
    const { fetchTile } = fakeFetcher(hill);
    const h = await computeHorizon(site, 0, tileSampler({ fetchTile, site }));
    const south = h.points[180 / 5];
    let best = -90;
    for (let d = 150; d <= 30_000; d += 5) best = Math.max(best, elevationAngle(hill(destination(site, 180, d)), 300, d));
    expect(Math.abs(south.elevation - best)).toBeLessThan(0.6); // log-spaced samples vs dense brute force
    expect(h.profile.elevations[0]).toBe(0); // nothing to the north
  }, 60_000);

  it("propagates tile download failures", async () => {
    const s = tileSampler({ site, fetchTile: async () => { throw new Error("HTTP 403"); } });
    await expect(s([site])).rejects.toThrow(/403/);
  });
  it("sampleBilinear reads exact pixel centres", () => {
    const tile = new Float32Array(TILE_SIZE * TILE_SIZE).map((_, i) => i);
    const get = () => tile;
    expect(sampleBilinear(10.5, 20.5, 0, get)).toBe(20 * TILE_SIZE + 10);
  });
});
