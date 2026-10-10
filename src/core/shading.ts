import { horizonAt, skyViewFactor, type HorizonProfile } from "./horizon";
import type { WeatherYear } from "./weather";

/**
 * Terrain shading prepared once per weather year and horizon profile:
 * which hours have the sun above the skyline, plus the ground's sky view.
 * The panel's own sky view depends on orientation and is computed per
 * orientation by simulateYear().
 */
export interface Shading {
  profile: HorizonProfile;
  /** 1 when the sun is above the skyline in that hour, else 0 */
  visible: Uint8Array;
  /** Sky view factor of horizontal ground with this horizon */
  skyViewHorizontal: number;
}

export function buildShading(w: WeatherYear, profile: HorizonProfile): Shading {
  const n = w.epochMs.length;
  const visible = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const alpha = 90 - w.apparentZenith[i];
    visible[i] = alpha > horizonAt(profile, w.azimuth[i]) ? 1 : 0;
  }
  return { profile, visible, skyViewHorizontal: skyViewFactor(profile, 0, 0) };
}
