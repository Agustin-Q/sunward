import { cosd } from "./math";
import { fmt as f } from "./trace";
import type { Tracer } from "./trace";

/** Standard sea-level pressure, Pa. */
export const P0 = 101325;

/**
 * Air pressure from altitude (pvlib.atmosphere.alt2pres).
 * p = 100 · ((44331.514 − h) / 11880.516)^(1/0.1902632)   [Pa]
 */
export function altitudeToPressure(altitude: number, t?: Tracer): number {
  const p = 100 * ((44331.514 - altitude) / 11880.516) ** (1 / 0.1902632);
  t?.add({
    key: "atm.pressure",
    label: "Air pressure at site altitude",
    symbol: "p",
    formula: "100 · ((44331.514 − h) / 11880.516)^(1/0.1902632)",
    substituted: `100 · ((44331.514 − ${f(altitude)}) / 11880.516)^(1/0.1902632)`,
    value: p,
    unit: "Pa",
  });
  return p;
}

/**
 * Relative air mass, Kasten & Young (1989). Uses apparent zenith.
 * AM = 1 / (cos z + 0.50572 · (96.07995 − z)^−1.6364). NaN when z > 90°.
 */
export function relativeAirmass(apparentZenith: number, t?: Tracer): number {
  const z = apparentZenith;
  const am = z > 90 ? NaN : 1 / (cosd(z) + 0.50572 * (6.07995 + (90 - z)) ** -1.6364);
  t?.add({
    key: "atm.airmassRelative",
    label: "Relative air mass (Kasten-Young)",
    symbol: "AM",
    formula: "1 / (cos z + 0.50572 · (96.07995 − z)^−1.6364)",
    substituted: `1 / (cos ${f(z)}° + 0.50572 · (96.07995 − ${f(z)})^−1.6364)`,
    value: am,
    unit: "–",
  });
  return am;
}

/** Absolute (pressure-corrected) air mass: AMa = AM · p / p0. */
export function absoluteAirmass(relative: number, pressure: number, t?: Tracer): number {
  const ama = (relative * pressure) / P0;
  t?.add({
    key: "atm.airmassAbsolute",
    label: "Absolute air mass (pressure corrected)",
    symbol: "AMa",
    formula: "AM · p / 101325",
    substituted: `${f(relative)} · ${f(pressure, 1)} / 101325`,
    value: ama,
    unit: "–",
  });
  return ama;
}
