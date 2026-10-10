import { dayOfYearUTC } from "./math";
import { fmt as f } from "./trace";
import type { Tracer } from "./trace";

export const SOLAR_CONSTANT = 1366.1;

/**
 * Extraterrestrial normal irradiance, Spencer (1971) — pvlib's default.
 * B = 2π(n−1)/365
 * I0 = 1366.1 · (1.00011 + 0.034221 cos B + 0.00128 sin B + 0.000719 cos 2B + 0.000077 sin 2B)
 */
export function extraterrestrialIrradiance(dayOfYear: number, t?: Tracer): number {
  const B = (2 * Math.PI * (dayOfYear - 1)) / 365;
  const r2 =
    1.00011 +
    0.034221 * Math.cos(B) +
    0.00128 * Math.sin(B) +
    0.000719 * Math.cos(2 * B) +
    0.000077 * Math.sin(2 * B);
  const I0 = SOLAR_CONSTANT * r2;
  t?.add({
    key: "etr.B",
    label: "Day angle",
    symbol: "B",
    formula: "2π · (n − 1) / 365",
    substituted: `2π · (${dayOfYear} − 1) / 365`,
    value: B,
    unit: "rad",
  });
  t?.add({
    key: "etr.dniExtra",
    label: "Sunlight at top of atmosphere",
    symbol: "I₀",
    formula: "1366.1 · (1.00011 + 0.034221 cos B + 0.00128 sin B + 0.000719 cos 2B + 0.000077 sin 2B)",
    substituted: `1366.1 · ${f(r2, 6)}`,
    value: I0,
    unit: "W/m²",
  });
  return I0;
}

export function extraterrestrialAt(epochMs: number, t?: Tracer): number {
  return extraterrestrialIrradiance(dayOfYearUTC(epochMs), t);
}
