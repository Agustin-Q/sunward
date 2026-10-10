import { fmt as f, type Tracer } from "./trace";

export interface SystemSpec {
  /** Peak power at STC (1000 W/m²), kWp */
  kWp: number;
  /** Performance ratio: temperature, inverter, wiring, soiling losses (0–1) */
  performanceRatio: number;
}

export const DEFAULT_SYSTEM: SystemSpec = { kWp: 5, performanceRatio: 0.8 };

/**
 * Electricity from plane-of-array irradiation.
 * E [kWh] = H [kWh/m²] × P_peak [kWp] × PR / G_STC, with G_STC = 1 kW/m².
 */
export function energyKWh(poaKWhPerM2: number, sys: SystemSpec, t?: Tracer, label = "Electricity"): number {
  if (sys.kWp < 0 || sys.performanceRatio < 0 || sys.performanceRatio > 1) throw new RangeError("invalid system spec");
  const e = poaKWhPerM2 * sys.kWp * sys.performanceRatio;
  t?.add({ key: `energy.${label}`, label, symbol: "E", formula: "H × kWp × PR / (1 kW/m²)", substituted: `${f(poaKWhPerM2, 2)} × ${f(sys.kWp)} × ${f(sys.performanceRatio)}`, value: e, unit: "kWh" });
  return e;
}
