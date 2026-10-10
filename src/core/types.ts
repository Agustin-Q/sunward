/** A site on Earth. Angles in degrees, altitude in metres above sea level. */
export interface Site {
  lat: number;
  lon: number;
  altitude: number;
}

/**
 * Panel orientation.
 * tilt: 0° = flat, 90° = vertical.
 * azimuth: direction the panel faces, clockwise from north (0 N, 90 E, 180 S, 270 W).
 */
export interface Orientation {
  tilt: number;
  azimuth: number;
}

export type TranspositionModel = "haydavies" | "isotropic";

export interface ModelParams {
  /** Linke turbidity for the clear-sky model (≈2 very clean, 3 typical, 5+ hazy). */
  linkeTurbidity: number;
  /** Ground reflectance (0.2 typical ground, ~0.8 fresh snow). */
  albedo: number;
  transposition: TranspositionModel;
}

export const DEFAULT_PARAMS: ModelParams = {
  linkeTurbidity: 3,
  albedo: 0.2,
  transposition: "haydavies",
};
