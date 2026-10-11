import { calculateSolarPosition } from "@yogur/solpos";
import { altitudeToPressure } from "./atmosphere";
import type { Site } from "./types";
import type { Tracer } from "./trace";

export interface SunPosition {
  /** Geometric zenith, degrees. */
  zenith: number;
  /** Refraction-corrected zenith, degrees (used for irradiance, as pvlib does). */
  apparentZenith: number;
  /** Clockwise from north, degrees. */
  azimuth: number;
}

/** Air temperature used for refraction (pvlib default). */
export const REFRACTION_TEMPERATURE_C = 12;

/**
 * Sun position from the NREL SPA (via the @yogur/solpos library).
 * Pressure comes from the site altitude; temperature 12 °C, like pvlib.
 */
export function sunPosition(epochMs: number, site: Site, t?: Tracer, pressurePa?: number): SunPosition {
  const p = pressurePa ?? altitudeToPressure(site.altitude);
  const r = calculateSolarPosition({
    // The library requires whole milliseconds; callers may pass fractional instants.
    instant: { epochMilliseconds: Math.round(epochMs) },
    observer: {
      latitudeDegrees: site.lat,
      longitudeDegrees: site.lon,
      elevationMeters: site.altitude,
    },
    atmosphere: { pressureMillibars: p / 100, temperatureCelsius: REFRACTION_TEMPERATURE_C },
  });
  const pos: SunPosition = {
    zenith: r.zenithDegrees,
    apparentZenith: r.apparent?.zenithDegrees ?? r.zenithDegrees,
    azimuth: r.azimuthDegrees,
  };
  if (t) {
    const lib = "computed by NREL SPA library (@yogur/solpos)";
    t.add({ key: "sun.zenith", label: "Solar zenith (geometric)", symbol: "θz", formula: "", substituted: lib, value: pos.zenith, unit: "°" });
    t.add({ key: "sun.refraction", label: "Atmospheric refraction", symbol: "Δθ", formula: "", substituted: lib, value: pos.zenith - pos.apparentZenith, unit: "°" });
    t.add({ key: "sun.apparentZenith", label: "Solar zenith (apparent)", symbol: "θz′", formula: "θz − Δθ", substituted: lib, value: pos.apparentZenith, unit: "°" });
    t.add({ key: "sun.elevation", label: "Solar elevation (apparent)", symbol: "α", formula: "90 − θz′", substituted: `90 − ${pos.apparentZenith.toFixed(4)}`, value: 90 - pos.apparentZenith, unit: "°" });
    t.add({ key: "sun.azimuth", label: "Solar azimuth (from north)", symbol: "γs", formula: "", substituted: lib, value: pos.azimuth, unit: "°" });
  }
  return pos;
}
