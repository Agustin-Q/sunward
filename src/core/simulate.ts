import { DAYS_IN_MONTH_2025 } from "./math";
import { planeOfArray } from "./planeOfArray";
import { fmt as f, type Tracer } from "./trace";
import type { ModelParams, Orientation } from "./types";
import type { WeatherYear } from "./weather";

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface YearResult {
  orientation: Orientation;
  /** kWh/m² per month on the panel */
  monthly: number[];
  /** Average kWh/m² per day, per month */
  dailyAvg: number[];
  /** kWh/m² per year */
  annual: number;
  /** Annual split by component, kWh/m² */
  components: { direct: number; skyDiffuse: number; ground: number };
}

/**
 * Sum hourly plane-of-array irradiance over the year.
 * Each hourly W/m² × 1 h = Wh/m²; monthly kWh/m² = Σ / 1000.
 */
export function simulateYear(w: WeatherYear, o: Orientation, params: ModelParams, t?: Tracer): YearResult {
  const monthlyWh = new Array(12).fill(0);
  let d = 0, s = 0, g = 0;
  const n = w.epochMs.length;
  for (let i = 0; i < n; i++) {
    if (w.ghi[i] <= 0) continue;
    const r = planeOfArray(
      o,
      w.apparentZenith[i],
      w.azimuth[i],
      { ghi: w.ghi[i], dni: w.dni[i], dhi: w.dhi[i] },
      w.dniExtra[i],
      params.albedo,
      params.transposition,
    );
    monthlyWh[w.month[i]] += r.global; // × 1 h
    d += r.direct;
    s += r.skyDiffuse;
    g += r.ground;
  }
  const monthly = monthlyWh.map((x) => x / 1000);
  const dailyAvg = monthly.map((x, m) => x / DAYS_IN_MONTH_2025[m]);
  const annual = monthly.reduce((a, b) => a + b, 0);
  if (t) {
    t.group(`Totals — tilt ${f(o.tilt)}°, azimuth ${f(o.azimuth)}°`);
    monthly.forEach((m, k) => {
      t.add({ key: `sum.monthly.${k}`, label: `${MONTHS[k]} total`, symbol: `H${k + 1}`, formula: "Σ POA(hour) · 1 h / 1000", substituted: `${f(monthlyWh[k], 1)} Wh/m² / 1000`, value: m, unit: "kWh/m²" });
      t.add({ key: `sum.daily.${k}`, label: `${MONTHS[k]} daily average`, symbol: `h${k + 1}`, formula: "H / days", substituted: `${f(m, 3)} / ${DAYS_IN_MONTH_2025[k]}`, value: dailyAvg[k], unit: "kWh/m²/day" });
    });
    t.add({ key: "sum.annual", label: "Annual total", symbol: "H", formula: "Σ H(month)", substituted: monthly.map((m) => f(m, 1)).join(" + "), value: annual, unit: "kWh/m²" });
  }
  return {
    orientation: { ...o },
    monthly,
    dailyAvg,
    annual,
    components: { direct: d / 1000, skyDiffuse: s / 1000, ground: g / 1000 },
  };
}

/** Annual total only (used by the optimizer). */
export function annualTotal(w: WeatherYear, o: Orientation, params: ModelParams): number {
  return simulateYear(w, o, params).annual;
}
