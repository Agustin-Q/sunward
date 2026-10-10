/** Pure UI helpers (unit-tested). */

/** Azimuth (0 = up/north, clockwise) of point (x,y) as seen from centre (cx,cy), screen coordinates. */
export function pointerAzimuth(cx: number, cy: number, x: number, y: number): number {
  const a = (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
  return (a + 360) % 360;
}

const POINTS16 = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
/** 16-point compass label for an azimuth. */
export function compassPoint(az: number): string {
  const i = Math.round((((az % 360) + 360) % 360) / 22.5) % 16;
  return POINTS16[i];
}

/** Sequential blue ramp (reference palette steps 100 → 700). */
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#1c5cab", "#104281", "#0d366b"];
const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
/** Colour for t in [0,1] along the sequential ramp. */
export function rampColor(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(x));
  const f = x - i;
  const a = hex(RAMP[i]), b = hex(RAMP[i + 1]);
  const c = a.map((v, k) => Math.round(v + (b[k] - v) * f));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
export const RAMP_STOPS = RAMP;

/**
 * Map a heatmap percentage to [0,1] for colouring. The interesting band is
 * near the top, so values below `floor` % all get the lightest colour.
 */
export function heatScale(pct: number, floor = 60): number {
  return Math.min(1, Math.max(0, (pct - floor) / (100 - floor)));
}

export function fmtNum(x: number, digits = 0): string {
  if (!Number.isFinite(x)) return "–";
  return x.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function fmtSigned(x: number, digits = 1): string {
  const s = fmtNum(Math.abs(x), digits);
  return x > 0 ? `+${s}` : x < 0 ? `−${s}` : s;
}

/** Day-of-year (1–365) for a YYYY-MM-DD string in the 2025 reference year, and back. */
export function dateToHourIndex(dateStr: string, hourUTC: number): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d, hourUTC, 30);
  const start = Date.UTC(2025, 0, 1, 0, 30);
  return Math.round((ms - start) / 3_600_000);
}

/** Clamp a numeric input value with a fallback. */
export function readNum(v: string, lo: number, hi: number, fallback: number): number {
  const x = parseFloat(v);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(hi, Math.max(lo, x));
}
