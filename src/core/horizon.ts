import { DEG, cosd, sind, wrap360 } from "./math";
import { fmt as f, type Tracer } from "./trace";

/**
 * Horizon profile: elevation angle of the skyline (degrees above horizontal)
 * at equally spaced azimuths, starting at north and going clockwise.
 * elevations[i] is the horizon at azimuth i · stepDeg.
 */
export interface HorizonProfile {
  stepDeg: number;
  elevations: number[];
}

export const HORIZON_STEP_DEG = 5;

export function flatHorizon(stepDeg = HORIZON_STEP_DEG): HorizonProfile {
  return { stepDeg, elevations: new Array(Math.round(360 / stepDeg)).fill(0) };
}

export function isValidProfile(p: unknown): p is HorizonProfile {
  const q = p as HorizonProfile;
  return !!q && typeof q.stepDeg === "number" && q.stepDeg > 0 && Array.isArray(q.elevations) &&
    Math.abs(q.elevations.length * q.stepDeg - 360) < 1e-9 && q.elevations.every((e) => Number.isFinite(e));
}

/** Horizon elevation at any azimuth: linear interpolation, wrapping 360° → 0°. */
export function horizonAt(p: HorizonProfile, azimuth: number): number {
  const n = p.elevations.length;
  const x = wrap360(azimuth) / p.stepDeg;
  const i = Math.floor(x) % n;
  const fr = x - Math.floor(x);
  return p.elevations[i] * (1 - fr) + p.elevations[(i + 1) % n] * fr;
}

/** Resample to a new step (linear interpolation). */
export function resample(p: HorizonProfile, stepDeg: number): HorizonProfile {
  const n = Math.round(360 / stepDeg);
  return { stepDeg, elevations: Array.from({ length: n }, (_, i) => horizonAt(p, i * stepDeg)) };
}

/** Highest point of the profile. */
export function horizonMax(p: HorizonProfile): { azimuth: number; elevation: number } {
  let k = 0;
  p.elevations.forEach((e, i) => { if (e > p.elevations[k]) k = i; });
  return { azimuth: k * p.stepDeg, elevation: p.elevations[k] };
}

/** True when the sun (apparent elevation α, azimuth γs) is above the skyline. */
export function sunVisible(p: HorizonProfile, apparentElevation: number, sunAzimuth: number): boolean {
  return apparentElevation > horizonAt(p, sunAzimuth);
}

/** Number of azimuth steps used to integrate the sky view factor (1°). */
export const SKY_VIEW_STEPS = 360;

/**
 * Sky view factor of a tilted surface with a horizon (Dozier & Frew 1990):
 *   e(φ)  = max(e_h(φ), e_plane(φ)),  e_plane(φ) = atan(−tan β · cos(φ − γ))
 *   H(φ)  = 90° − e(φ)
 *   Fsky  = (1/2π) ∫ [ cos β · sin²H + sin β · cos(φ − γ) · (H − sin H cos H) ] dφ
 * Equals (1 + cos β)/2 for a flat horizon. It weights isotropic sky diffuse.
 */
export function skyViewFactor(p: HorizonProfile, tilt: number, azimuth: number, steps = SKY_VIEW_STEPS): number {
  const cb = cosd(tilt), sb = sind(tilt), tb = Math.tan(tilt * DEG);
  let sum = 0;
  for (let k = 0; k < steps; k++) {
    const phi = (k + 0.5) * (360 / steps);
    const c = cosd(phi - azimuth);
    const ePlane = tilt >= 90 ? (c > 0 ? -Math.PI / 2 : c < 0 ? Math.PI / 2 : 0) : Math.atan(-tb * c);
    const e = Math.max(horizonAt(p, phi) * DEG, ePlane);
    const H = Math.PI / 2 - e;
    sum += cb * Math.sin(H) ** 2 + sb * c * (H - Math.sin(H) * Math.cos(H));
  }
  return sum / steps;
}

/** Shading factors for one hour and one orientation. */
export interface ShadeFactors {
  sunVisible: boolean;
  /** Sky view factor of the panel with horizon (replaces (1+cos β)/2). */
  skyView: number;
  /** Sky view factor of horizontal ground with horizon (for ground reflection). */
  skyViewHorizontal: number;
}

/** Trace the horizon steps for one hour. Returns the shade factors. */
export function traceShade(p: HorizonProfile, apparentZenith: number, sunAzimuth: number, tilt: number, azimuth: number, t?: Tracer): ShadeFactors {
  const eh = horizonAt(p, sunAzimuth);
  const alpha = 90 - apparentZenith;
  const vis = alpha > eh;
  const sv = skyViewFactor(p, tilt, azimuth);
  const svh = skyViewFactor(p, 0, 0);
  if (t) {
    t.add({ key: "shade.horizonAtSun", label: "Horizon height at sun azimuth", symbol: "e_h(γs)", formula: "interpolate profile at γs", substituted: `profile at ${f(sunAzimuth)}°`, value: eh, unit: "°" });
    t.add({ key: "shade.sunElevation", label: "Sun elevation (apparent)", symbol: "α", formula: "90 − θz′", substituted: `90 − ${f(apparentZenith)}`, value: alpha, unit: "°" });
    t.add({ key: "shade.visible", label: "Sun above skyline", symbol: "v", formula: "α > e_h(γs) ? 1 : 0", substituted: `${f(alpha)} > ${f(eh)}`, value: vis ? 1 : 0, unit: "" });
    t.add({ key: "shade.skyView", label: "Sky view of panel with horizon", symbol: "Fsky,h", formula: "(1/2π)∫[cos β sin²H + sin β cos(φ−γ)(H − sin H cos H)]dφ", substituted: `β ${f(tilt)}°, γ ${f(azimuth)}° (flat: ${f((1 + cosd(tilt)) / 2)})`, value: sv, unit: "–" });
    t.add({ key: "shade.skyViewHorizontal", label: "Sky view of ground with horizon", symbol: "Fsky,h(0)", formula: "same, β = 0", substituted: "", value: svh, unit: "–" });
  }
  return { sunVisible: vis, skyView: sv, skyViewHorizontal: svh };
}

// ---- URL encoding: one byte per sample, 0.5° resolution (0–127.5°), base64url ----

export function encodeProfile(p: HorizonProfile): string {
  const q = p.stepDeg === HORIZON_STEP_DEG ? p : resample(p, HORIZON_STEP_DEG);
  const bytes = q.elevations.map((e) => Math.max(0, Math.min(255, Math.round(e * 2))));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function decodeProfile(s: string): HorizonProfile | null {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
    const n = 360 / HORIZON_STEP_DEG;
    if (bin.length !== n) return null;
    return { stepDeg: HORIZON_STEP_DEG, elevations: Array.from(bin, (c) => c.charCodeAt(0) / 2) };
  } catch {
    return null;
  }
}
