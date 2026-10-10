export const DEG = Math.PI / 180;
export const cosd = (d: number) => Math.cos(d * DEG);
export const sind = (d: number) => Math.sin(d * DEG);
export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Normalise an angle to [0, 360). */
export function wrap360(a: number): number {
  const r = a % 360;
  return r < 0 ? r + 360 : r;
}

/** Signed smallest difference a − b, in (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  let d = wrap360(a - b);
  if (d > 180) d -= 360;
  return d;
}

/** Day of year (1–366) of a UTC instant. */
export function dayOfYearUTC(epochMs: number): number {
  const d = new Date(epochMs);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.floor((epochMs - start) / 86_400_000) + 1;
}

export const DAYS_IN_MONTH_2025 = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
