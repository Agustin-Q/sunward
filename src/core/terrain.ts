import { DEG } from "./math";
import { HORIZON_STEP_DEG, type HorizonProfile } from "./horizon";
import { fmt as f, type Tracer } from "./trace";

export interface LatLon { lat: number; lon: number }

/**
 * Returns ground elevation (m above sea level) for each point, in order.
 * Injected so this module stays pure: the UI passes an Open-Meteo sampler,
 * tests pass synthetic terrain.
 */
export type ElevationSampler = (points: LatLon[]) => Promise<number[]>;

export interface TerrainOptions {
  /** Azimuth step of the profile, degrees */
  stepDeg: number;
  /** Nearest sample distance, m (the 90 m DEM is too coarse closer in) */
  minDistance: number;
  /** Farthest sample distance, m */
  maxDistance: number;
  /** Samples per ray, log-spaced between min and max distance */
  samples: number;
  /** Atmospheric refraction coefficient for the curvature correction */
  refraction: number;
}

export const DEFAULT_TERRAIN: TerrainOptions = { stepDeg: HORIZON_STEP_DEG, minDistance: 150, maxDistance: 30_000, samples: 24, refraction: 0.13 };

/** Mean Earth radius, m (IUGG). */
export const EARTH_RADIUS = 6_371_008.8;

/** Log-spaced distances from min to max (inclusive). */
export function rayDistances(o: Pick<TerrainOptions, "minDistance" | "maxDistance" | "samples">): number[] {
  const { minDistance: a, maxDistance: b, samples: n } = o;
  if (n === 1) return [a];
  const r = Math.log(b / a) / (n - 1);
  return Array.from({ length: n }, (_, i) => a * Math.exp(r * i));
}

/** Great-circle destination from a point, bearing (° from north) and distance (m). */
export function destination(p: LatLon, bearingDeg: number, distance: number): LatLon {
  const d = distance / EARTH_RADIUS, b = bearingDeg * DEG;
  const la1 = p.lat * DEG, lo1 = p.lon * DEG;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: la2 / DEG, lon: ((((lo2 / DEG) + 540) % 360) - 180) };
}

/** Great-circle distance, m (haversine). */
export function distanceBetween(a: LatLon, b: LatLon): number {
  const dla = (b.lat - a.lat) * DEG, dlo = (b.lon - a.lon) * DEG;
  const h = Math.sin(dla / 2) ** 2 + Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dlo / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How far a distant point appears lowered by the Earth's curvature, with
 * refraction: drop = d² · (1 − k) / (2R).
 */
export function curvatureDrop(distance: number, refraction = DEFAULT_TERRAIN.refraction): number {
  return (distance * distance * (1 - refraction)) / (2 * EARTH_RADIUS);
}

/** Elevation angle (°) of a terrain point seen from the observer. */
export function elevationAngle(terrainAltitude: number, observerAltitude: number, distance: number, refraction = DEFAULT_TERRAIN.refraction): number {
  return Math.atan2(terrainAltitude - curvatureDrop(distance, refraction) - observerAltitude, distance) / DEG;
}

/** The point that sets the horizon in one direction. */
export interface HorizonPoint {
  azimuth: number;
  /** Elevation angle of the blocking point, ° (can be negative on a hilltop) */
  elevation: number;
  /** Distance to the blocking point, m */
  distance: number;
  /** Ground altitude of the blocking point, m */
  terrainAltitude: number;
}

export interface TerrainHorizon {
  /** Profile used by the model (negative angles clamped to 0) */
  profile: HorizonProfile;
  points: HorizonPoint[];
  /** Ground altitude at the site from the elevation data, m */
  groundAltitude: number;
  /** groundAltitude + panel height, m */
  observerAltitude: number;
  panelHeight: number;
  samplesUsed: number;
}

/**
 * Compute the horizon by casting rays over elevation data:
 *   e(φ) = max_d atan2(z(φ, d) − drop(d) − (z₀ + h_panel), d)
 * Rays every `stepDeg`, `samples` log-spaced distances each.
 */
export async function computeHorizon(
  site: LatLon,
  panelHeight: number,
  sampler: ElevationSampler,
  options: Partial<TerrainOptions> = {},
  t?: Tracer,
): Promise<TerrainHorizon> {
  const o = { ...DEFAULT_TERRAIN, ...options };
  const n = Math.round(360 / o.stepDeg);
  const dists = rayDistances(o);
  const points: LatLon[] = [site];
  for (let i = 0; i < n; i++) for (const d of dists) points.push(destination(site, i * o.stepDeg, d));
  const z = await sampler(points);
  if (z.length !== points.length || z.some((v) => !Number.isFinite(v))) throw new Error("elevation data incomplete");

  const groundAltitude = z[0];
  const observerAltitude = groundAltitude + panelHeight;
  const result: HorizonPoint[] = [];
  for (let i = 0; i < n; i++) {
    let best: HorizonPoint = { azimuth: i * o.stepDeg, elevation: -90, distance: 0, terrainAltitude: NaN };
    dists.forEach((d, k) => {
      const zt = z[1 + i * dists.length + k];
      const e = elevationAngle(zt, observerAltitude, d, o.refraction);
      if (e > best.elevation) best = { azimuth: i * o.stepDeg, elevation: e, distance: d, terrainAltitude: zt };
    });
    result.push(best);
  }
  const profile: HorizonProfile = { stepDeg: o.stepDeg, elevations: result.map((p) => Math.max(0, p.elevation)) };
  if (t) {
    const top = result.reduce((a, b) => (b.elevation > a.elevation ? b : a));
    t.group("Terrain horizon");
    t.add({ key: "terrain.ground", label: "Ground altitude at site (elevation data)", symbol: "z₀", formula: "", substituted: "terrain elevation data", value: groundAltitude, unit: "m" });
    t.add({ key: "terrain.observer", label: "Observer altitude", symbol: "z_obs", formula: "z₀ + panel height", substituted: `${f(groundAltitude, 1)} + ${f(panelHeight, 1)}`, value: observerAltitude, unit: "m" });
    t.add({ key: "terrain.rays", label: "Rays × samples", symbol: "", formula: `${n} directions × ${dists.length} distances`, substituted: `${f(o.minDistance)}–${f(o.maxDistance)} m, log-spaced`, value: points.length, unit: "points" });
    t.add({ key: "terrain.drop30", label: "Curvature drop at max distance", symbol: "drop", formula: "d² · (1 − k) / (2R)", substituted: `${f(o.maxDistance)}² · (1 − ${f(o.refraction)}) / (2 · 6371008.8)`, value: curvatureDrop(o.maxDistance, o.refraction), unit: "m" });
    t.add({ key: "terrain.highest", label: "Highest horizon point", symbol: "max e", formula: "atan2(z − drop − z_obs, d)", substituted: `${f(top.azimuth)}° at ${f(top.distance / 1000, 2)} km, ground ${f(top.terrainAltitude, 0)} m`, value: top.elevation, unit: "°" });
  }
  return { profile, points: result, groundAltitude, observerAltitude, panelHeight, samplesUsed: points.length };
}
