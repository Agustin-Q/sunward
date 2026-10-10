import { isValidProfile, type HorizonPoint, type HorizonProfile } from "../core";

/** What we keep about a computed (or link-supplied) horizon. */
export interface CachedHorizon {
  profile: HorizonProfile;
  /** Blocking point per azimuth; absent when the profile came from a shared link */
  points?: HorizonPoint[];
  groundAltitude?: number;
  observerAltitude?: number;
  source: "terrain" | "link";
  computedAt: number;
}

const PREFIX = "sunward.horizon.";

/** Cache key: site rounded to ~10 m and panel height to 0.1 m. */
export function horizonKey(lat: number, lon: number, panelHeight: number): string {
  return `${lat.toFixed(4)},${lon.toFixed(4)},${panelHeight.toFixed(1)}`;
}

export function parseCached(raw: string | null): CachedHorizon | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!isValidProfile(v?.profile)) return null;
    if (v.points !== undefined && (!Array.isArray(v.points) || v.points.length !== v.profile.elevations.length)) return null;
    return { ...v, source: v.source === "link" ? "link" : "terrain" } as CachedHorizon;
  } catch {
    return null;
  }
}

export function readHorizon(key: string): CachedHorizon | null {
  try { return parseCached(localStorage.getItem(PREFIX + key)); } catch { return null; }
}

export function writeHorizon(key: string, h: CachedHorizon): void {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(h)); } catch { /* storage full or blocked */ }
}
