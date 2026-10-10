import { horizonAt, sunPosition, type HorizonProfile, type Site } from "../core";

/** One sun path (the 21st of a month), sampled every `stepMin` minutes while the sun is up. */
export interface SunPath {
  label: string;
  /** month index (0–11) of the date used */
  month: number;
  points: { azimuth: number; elevation: number; epochMs: number }[];
  /** Mean-solar-time full hours: index into points of each hour mark */
  hours: { hour: number; azimuth: number; elevation: number }[];
}

/** Months with distinct paths (others mirror them): label by pair. */
export const PATH_MONTHS: { month: number; label: string }[] = [
  { month: 5, label: "Jun 21" },
  { month: 4, label: "May/Jul" },
  { month: 3, label: "Apr/Aug" },
  { month: 2, label: "Mar/Sep" },
  { month: 1, label: "Feb/Oct" },
  { month: 0, label: "Jan/Nov" },
  { month: 11, label: "Dec 21" },
];

/** Sun paths for the 21st of the representative months (apparent elevation). */
export function sunPaths(site: Site, stepMin = 10): SunPath[] {
  return PATH_MONTHS.map(({ month, label }) => {
    // Mean solar midnight → next midnight: shift UTC by the longitude.
    const start = Date.UTC(2025, month, 21) - (site.lon / 15) * 3_600_000;
    const points: SunPath["points"] = [];
    const hours: SunPath["hours"] = [];
    for (let m = 0; m <= 24 * 60; m += stepMin) {
      const ms = start + m * 60_000;
      const p = sunPosition(ms, site);
      const el = 90 - p.apparentZenith;
      if (el > 0) {
        points.push({ azimuth: p.azimuth, elevation: el, epochMs: ms });
        if (m % 60 === 0) hours.push({ hour: m / 60, azimuth: p.azimuth, elevation: el });
      }
    }
    return { label, month, points, hours };
  });
}

/** Split a path into runs above / below the skyline, for drawing. */
export function splitByHorizon(path: SunPath, profile: HorizonProfile | null): { visible: boolean; points: SunPath["points"] }[] {
  const runs: { visible: boolean; points: SunPath["points"] }[] = [];
  for (const p of path.points) {
    const vis = !profile || p.elevation > horizonAt(profile, p.azimuth);
    const last = runs[runs.length - 1];
    if (last && last.visible === vis) last.points.push(p);
    else {
      // repeat the boundary point so runs connect
      const prev = last?.points[last.points.length - 1];
      runs.push({ visible: vis, points: prev ? [prev, p] : [p] });
    }
  }
  return runs;
}

/** Share of daylight sun-path time hidden behind the skyline, per path. */
export function hiddenShare(path: SunPath, profile: HorizonProfile): number {
  if (path.points.length === 0) return 0;
  const hidden = path.points.filter((p) => p.elevation <= horizonAt(profile, p.azimuth)).length;
  return hidden / path.points.length;
}
