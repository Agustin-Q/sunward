import { angleDiff } from "./math";
import { MONTHS, type YearResult } from "./simulate";
import { fmt as f, type Tracer } from "./trace";

export interface Comparison {
  deviation: { tilt: number; azimuth: number };
  /** kWh/m² lost per month (optimal − current; negative = current better that month) */
  lossMonthly: number[];
  /** % of optimal lost per month */
  lossMonthlyPct: number[];
  lossAnnual: number;
  lossAnnualPct: number;
}

/**
 * Compare a current orientation against the optimal one.
 * Loss % = (H_opt − H_cur) / H_opt · 100.
 * Azimuth deviation is the signed smallest angle (−180, 180].
 */
export function compare(current: YearResult, optimal: YearResult, t?: Tracer): Comparison {
  const dTilt = current.orientation.tilt - optimal.orientation.tilt;
  const dAz = angleDiff(current.orientation.azimuth, optimal.orientation.azimuth);
  const lossMonthly = optimal.monthly.map((o, k) => o - current.monthly[k]);
  const lossMonthlyPct = optimal.monthly.map((o, k) => (o > 0 ? ((o - current.monthly[k]) / o) * 100 : 0));
  const lossAnnual = optimal.annual - current.annual;
  const lossAnnualPct = optimal.annual > 0 ? (lossAnnual / optimal.annual) * 100 : 0;
  if (t) {
    t.group("Loss vs optimal");
    t.add({ key: "loss.dTilt", label: "Tilt deviation", symbol: "Δβ", formula: "β_you − β_opt", substituted: `${f(current.orientation.tilt)} − ${f(optimal.orientation.tilt)}`, value: dTilt, unit: "°" });
    t.add({ key: "loss.dAz", label: "Azimuth deviation", symbol: "Δγ", formula: "wrap±180(γ_you − γ_opt)", substituted: `wrap(${f(current.orientation.azimuth)} − ${f(optimal.orientation.azimuth)})`, value: dAz, unit: "°" });
    lossMonthlyPct.forEach((p, k) =>
      t.add({ key: `loss.monthlyPct.${k}`, label: `${MONTHS[k]} loss`, symbol: `L${k + 1}`, formula: "(H_opt − H_you) / H_opt · 100", substituted: `(${f(optimal.monthly[k], 2)} − ${f(current.monthly[k], 2)}) / ${f(optimal.monthly[k], 2)} · 100`, value: p, unit: "%" }),
    );
    t.add({ key: "loss.annual", label: "Annual loss", symbol: "ΔH", formula: "H_opt − H_you", substituted: `${f(optimal.annual, 2)} − ${f(current.annual, 2)}`, value: lossAnnual, unit: "kWh/m²" });
    t.add({ key: "loss.annualPct", label: "Annual loss", symbol: "L", formula: "ΔH / H_opt · 100", substituted: `${f(lossAnnual, 3)} / ${f(optimal.annual, 2)} · 100`, value: lossAnnualPct, unit: "%" });
  }
  return { deviation: { tilt: dTilt, azimuth: dAz }, lossMonthly, lossMonthlyPct, lossAnnual, lossAnnualPct };
}
