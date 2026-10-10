import { wrap360 } from "./math";
import { annualTotal } from "./simulate";
import type { Shading } from "./shading";
import { fmt as f, type Tracer } from "./trace";
import type { ModelParams, Orientation } from "./types";
import type { WeatherYear } from "./weather";

export interface Heatmap {
  tilts: number[];
  azimuths: number[];
  /** values[i][j] = annual kWh/m² at tilts[i], azimuths[j] */
  values: number[][];
}

export interface OptimizeResult {
  best: Orientation;
  annual: number;
  heatmap: Heatmap;
  /** Number of orientations evaluated */
  evaluations: number;
}

export interface OptimizeOptions {
  coarseTiltStep?: number;
  coarseAzimuthStep?: number;
  refineTiltSpan?: number;
  refineAzimuthSpan?: number;
  refineStep?: number;
  /** Terrain shading to apply (optional) */
  shading?: Shading;
}

const range = (a: number, b: number, step: number) => {
  const out: number[] = [];
  for (let x = a; x <= b + 1e-9; x += step) out.push(Number(x.toFixed(6)));
  return out;
};

/** Equator-facing azimuth for a latitude: south in the north, north in the south. */
export const equatorFacing = (lat: number) => (lat >= 0 ? 180 : 0);

/**
 * Find the fixed tilt/azimuth that maximises annual plane-of-array irradiance.
 * 1. Coarse grid over tilt 0–90° and azimuth 0–360° (also the heatmap).
 * 2. Fine grid (1°) around the coarse best.
 * A flat panel (tilt 0) has no meaningful azimuth: it is reported equator-facing.
 */
export function optimize(w: WeatherYear, params: ModelParams, opts: OptimizeOptions = {}, t?: Tracer): OptimizeResult {
  const ts = opts.coarseTiltStep ?? 5;
  const as = opts.coarseAzimuthStep ?? 10;
  const tSpan = opts.refineTiltSpan ?? ts;
  const aSpan = opts.refineAzimuthSpan ?? as;
  const step = opts.refineStep ?? 1;
  const sh = opts.shading;

  const tilts = range(0, 90, ts);
  const azimuths = range(0, 360 - as, as);
  const values: number[][] = [];
  let best: Orientation = { tilt: 0, azimuth: equatorFacing(w.site.lat) };
  let bestV = -Infinity;
  let evaluations = 0;

  // Flat panel is azimuth-independent: compute once per row.
  for (const tilt of tilts) {
    const row: number[] = [];
    const flat = tilt === 0 ? annualTotal(w, { tilt: 0, azimuth: 0 }, params, sh) : NaN;
    if (tilt === 0) evaluations++;
    for (const az of azimuths) {
      const v = tilt === 0 ? flat : annualTotal(w, { tilt, azimuth: az }, params, sh);
      if (tilt !== 0) evaluations++;
      row.push(v);
      if (v > bestV + 1e-9) {
        bestV = v;
        best = { tilt, azimuth: az };
      }
    }
    values.push(row);
  }
  const coarse = { ...best, v: bestV };
  t?.group("Optimizer");
  t?.add({ key: "opt.coarse", label: `Coarse grid best (${tilts.length}×${azimuths.length})`, symbol: "H*", formula: "max over grid", substituted: `tilt ${f(coarse.tilt)}°, azimuth ${f(coarse.azimuth)}°`, value: coarse.v, unit: "kWh/m²" });

  for (const tilt of range(Math.max(0, coarse.tilt - tSpan), Math.min(90, coarse.tilt + tSpan), step)) {
    const azs = tilt === 0 ? [0] : range(coarse.azimuth - aSpan, coarse.azimuth + aSpan, step);
    for (const a of azs) {
      const az = wrap360(a);
      const v = annualTotal(w, { tilt, azimuth: az }, params, sh);
      evaluations++;
      if (v > bestV + 1e-9) {
        bestV = v;
        best = { tilt, azimuth: az };
      }
    }
  }
  if (best.tilt === 0) best.azimuth = equatorFacing(w.site.lat);
  t?.add({ key: "opt.refined", label: `Refined best (${step}° steps)`, symbol: "H*", formula: "max over fine grid", substituted: `tilt ${f(best.tilt)}°, azimuth ${f(best.azimuth)}°`, value: bestV, unit: "kWh/m²" });
  t?.add({ key: "opt.evaluations", label: "Orientations evaluated", symbol: "N", formula: "", substituted: "", value: evaluations, unit: "" });
  return { best, annual: bestV, heatmap: { tilts, azimuths, values }, evaluations };
}
