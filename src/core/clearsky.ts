import { cosd } from "./math";
import { fmt as f } from "./trace";
import type { Tracer } from "./trace";

export interface Irradiance {
  /** Global horizontal irradiance, W/m² */
  ghi: number;
  /** Direct normal irradiance, W/m² */
  dni: number;
  /** Diffuse horizontal irradiance, W/m² */
  dhi: number;
}

/**
 * Ineichen & Perez (2002) clear-sky model, as implemented by
 * pvlib.clearsky.ineichen (perez_enhancement = False).
 *
 * @param apparentZenith refraction-corrected zenith [°]
 * @param airmassAbsolute pressure-corrected air mass [–]
 * @param linkeTurbidity Linke turbidity TL [–]
 * @param altitude site altitude h [m]
 * @param dniExtra extraterrestrial irradiance I0 [W/m²]
 */
export function ineichen(
  apparentZenith: number,
  airmassAbsolute: number,
  linkeTurbidity: number,
  altitude: number,
  dniExtra: number,
  t?: Tracer,
): Irradiance {
  const cosZ = Math.max(cosd(apparentZenith), 0);
  if (!(cosZ > 0) || !Number.isFinite(airmassAbsolute)) {
    t?.add({ key: "clearsky.night", label: "Sun below horizon → no irradiance", symbol: "", formula: "θz′ ≥ 90°", substituted: `${f(apparentZenith)}° ≥ 90°`, value: 0, unit: "" });
    return { ghi: 0, dni: 0, dhi: 0 };
  }
  const tl = linkeTurbidity;
  const h = altitude;
  const am = airmassAbsolute;

  const fh1 = Math.exp(-h / 8000);
  const fh2 = Math.exp(-h / 1250);
  const cg1 = 5.09e-5 * h + 0.868;
  const cg2 = 3.92e-5 * h + 0.0387;

  const ghi = cg1 * dniExtra * cosZ * Math.max(Math.exp(-cg2 * am * (fh1 + fh2 * (tl - 1))), 0);

  const b = 0.664 + 0.163 / fh1;
  const bnci = dniExtra * Math.max(b * Math.exp(-0.09 * am * (tl - 1)), 0);
  const ratio = (1 - (0.1 - 0.2 * Math.exp(-tl)) / (0.1 + 0.882 / fh1)) / cosZ;
  const bnci2 = ghi * Math.min(Math.max(ratio, 0), 1e20);
  const dni = Math.min(bnci, bnci2);
  const dhi = ghi - dni * cosZ;

  if (t) {
    t.add({ key: "clearsky.fh1", label: "Altitude factor 1", symbol: "fh1", formula: "e^(−h/8000)", substituted: `e^(−${f(h)}/8000)`, value: fh1, unit: "–" });
    t.add({ key: "clearsky.fh2", label: "Altitude factor 2", symbol: "fh2", formula: "e^(−h/1250)", substituted: `e^(−${f(h)}/1250)`, value: fh2, unit: "–" });
    t.add({ key: "clearsky.cg1", label: "Coefficient cg1", symbol: "cg1", formula: "5.09e−5 · h + 0.868", substituted: `5.09e−5 · ${f(h)} + 0.868`, value: cg1, unit: "–" });
    t.add({ key: "clearsky.cg2", label: "Coefficient cg2", symbol: "cg2", formula: "3.92e−5 · h + 0.0387", substituted: `3.92e−5 · ${f(h)} + 0.0387`, value: cg2, unit: "–" });
    t.add({ key: "clearsky.ghi", label: "Global horizontal (clear sky)", symbol: "GHI", formula: "cg1 · I₀ · cos θz′ · e^(−cg2 · AMa · (fh1 + fh2·(TL−1)))", substituted: `${f(cg1)} · ${f(dniExtra, 2)} · ${f(cosZ)} · e^(−${f(cg2)} · ${f(am)} · (${f(fh1)} + ${f(fh2)}·(${f(tl)}−1)))`, value: ghi, unit: "W/m²" });
    t.add({ key: "clearsky.b", label: "Beam coefficient", symbol: "b", formula: "0.664 + 0.163 / fh1", substituted: `0.664 + 0.163 / ${f(fh1)}`, value: b, unit: "–" });
    t.add({ key: "clearsky.dniUncapped", label: "Direct normal before cap", symbol: "DNI₁", formula: "I₀ · b · e^(−0.09 · AMa · (TL−1))", substituted: `${f(dniExtra, 2)} · ${f(b)} · e^(−0.09 · ${f(am)} · (${f(tl)}−1))`, value: bnci, unit: "W/m²" });
    t.add({ key: "clearsky.dniCap", label: "Direct normal cap from GHI", symbol: "DNI₂", formula: "GHI · (1 − (0.1 − 0.2e^(−TL)) / (0.1 + 0.882/fh1)) / cos θz′", substituted: `${f(ghi, 2)} · ${f(ratio * cosZ)} / ${f(cosZ)}`, value: bnci2, unit: "W/m²" });
    t.add({ key: "clearsky.dni", label: "Direct normal (clear sky)", symbol: "DNI", formula: "min(DNI₁, DNI₂)", substituted: `min(${f(bnci, 2)}, ${f(bnci2, 2)})`, value: dni, unit: "W/m²" });
    t.add({ key: "clearsky.dhi", label: "Diffuse horizontal (clear sky)", symbol: "DHI", formula: "GHI − DNI · cos θz′", substituted: `${f(ghi, 2)} − ${f(dni, 2)} · ${f(cosZ)}`, value: dhi, unit: "W/m²" });
  }
  return { ghi, dni, dhi };
}
