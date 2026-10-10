import { dayOfYearUTC } from "./math";
import { planeOfArray, type PoaComponents } from "./planeOfArray";
import { textbookSun } from "./textbook";
import { createTracer, fmt as f, type TraceStep, type Tracer } from "./trace";
import type { ModelParams, Orientation, Site } from "./types";
import type { HourInputs, WeatherSource, WeatherYear } from "./weather";

export interface HourTrace {
  steps: TraceStep[];
  inputs: HourInputs;
  poa: PoaComponents;
}

/**
 * Run the full chain for one hour with tracing on, using exactly the same
 * functions as the yearly simulation.
 */
export async function traceHour(
  source: WeatherSource,
  site: Site,
  params: ModelParams,
  o: Orientation,
  epochMs: number,
): Promise<HourTrace> {
  const t: Tracer = createTracer();
  t.group("Inputs");
  t.add({ key: "in.lat", label: "Latitude", symbol: "φ", formula: "", substituted: "", value: site.lat, unit: "°" });
  t.add({ key: "in.lon", label: "Longitude", symbol: "λ", formula: "", substituted: "", value: site.lon, unit: "°" });
  t.add({ key: "in.alt", label: "Altitude", symbol: "h", formula: "", substituted: "", value: site.altitude, unit: "m" });
  t.add({ key: "in.tilt", label: "Panel tilt", symbol: "β", formula: "", substituted: "", value: o.tilt, unit: "°" });
  t.add({ key: "in.azimuth", label: "Panel azimuth", symbol: "γ", formula: "", substituted: "0 N, 90 E, 180 S, 270 W", value: o.azimuth, unit: "°" });
  t.add({ key: "in.albedo", label: "Ground albedo", symbol: "ρ", formula: "", substituted: "", value: params.albedo, unit: "–" });
  t.group("Time");
  t.add({ key: "time.epoch", label: "Instant (UTC)", symbol: "t", formula: "", substituted: new Date(epochMs).toISOString().replace(".000Z", "Z"), value: epochMs, unit: "ms" });
  t.add({ key: "time.doy", label: "Day of year", symbol: "n", formula: "", substituted: "", value: dayOfYearUTC(epochMs), unit: "" });

  const inputs = await source.hour(site, params, epochMs, t);

  t.group(params.transposition === "haydavies" ? "Irradiance on panel (Hay-Davies)" : "Irradiance on panel (isotropic)");
  const poa = planeOfArray(o, inputs.sun.apparentZenith, inputs.sun.azimuth, inputs.irr, inputs.dniExtra, params.albedo, params.transposition, t);
  t.add({ key: "poa.hourEnergy", label: "Energy this hour", symbol: "POA·1h", formula: "POA × 1 h", substituted: `${f(poa.global, 2)} W/m² × 1 h`, value: poa.global, unit: "Wh/m²" });

  t.group("Textbook check (approximate, not used in results)");
  const tb = textbookSun(epochMs, site, t);
  t.add({ key: "tb.diff", label: "Approx. − SPA zenith", symbol: "Δ", formula: "θz≈ − θz", substituted: `${f(tb.zenith)} − ${f(inputs.sun.zenith)}`, value: tb.zenith - inputs.sun.zenith, unit: "°" });
  return { steps: t.steps, inputs, poa };
}

/** One row of the day table / CSV export. */
export interface HourRow {
  epochMs: number;
  apparentZenith: number;
  azimuth: number;
  dniExtra: number;
  ghi: number;
  dni: number;
  dhi: number;
  cosAoi: number;
  direct: number;
  circumsolar: number;
  isotropic: number;
  ground: number;
  poa: number;
}

export const HOUR_ROW_COLUMNS: { key: keyof HourRow; label: string; unit: string }[] = [
  { key: "epochMs", label: "UTC", unit: "" },
  { key: "apparentZenith", label: "θz′", unit: "°" },
  { key: "azimuth", label: "γs", unit: "°" },
  { key: "dniExtra", label: "I₀", unit: "W/m²" },
  { key: "ghi", label: "GHI", unit: "W/m²" },
  { key: "dni", label: "DNI", unit: "W/m²" },
  { key: "dhi", label: "DHI", unit: "W/m²" },
  { key: "cosAoi", label: "cos θ", unit: "" },
  { key: "direct", label: "Eb", unit: "W/m²" },
  { key: "circumsolar", label: "Ed,cs", unit: "W/m²" },
  { key: "isotropic", label: "Ed,iso", unit: "W/m²" },
  { key: "ground", label: "Eg", unit: "W/m²" },
  { key: "poa", label: "POA", unit: "W/m²" },
];

/** Per-hour rows for a range of hour indices of the weather year. */
export function hourRows(w: WeatherYear, o: Orientation, params: ModelParams, from = 0, to = w.epochMs.length): HourRow[] {
  const rows: HourRow[] = [];
  for (let i = from; i < to; i++) {
    const t = createTracer();
    const r = planeOfArray(o, w.apparentZenith[i], w.azimuth[i], { ghi: w.ghi[i], dni: w.dni[i], dhi: w.dhi[i] }, w.dniExtra[i], params.albedo, params.transposition, t);
    rows.push({
      epochMs: w.epochMs[i],
      apparentZenith: w.apparentZenith[i],
      azimuth: w.azimuth[i],
      dniExtra: w.dniExtra[i],
      ghi: w.ghi[i],
      dni: w.dni[i],
      dhi: w.dhi[i],
      cosAoi: t.steps.find((s) => s.key === "poa.cosAoi")!.value,
      direct: r.direct,
      circumsolar: r.circumsolar,
      isotropic: r.isotropic,
      ground: r.ground,
      poa: r.global,
    });
  }
  return rows;
}

export function rowsToCsv(rows: HourRow[]): string {
  const head = HOUR_ROW_COLUMNS.map((c) => (c.unit ? `${c.key} [${c.unit}]` : c.key)).join(",");
  const lines = rows.map((r) =>
    HOUR_ROW_COLUMNS.map((c) => (c.key === "epochMs" ? new Date(r.epochMs).toISOString() : Number(r[c.key].toFixed(6)))).join(","),
  );
  return [head, ...lines].join("\n");
}

/** A runnable pvlib snippet that reproduces the given hour independently. */
export function pvlibSnippet(site: Site, params: ModelParams, o: Orientation, epochMs: number): string {
  const iso = new Date(epochMs).toISOString().replace(".000Z", "");
  return `# pip install pvlib
import pandas as pd, pvlib
from pvlib import irradiance
loc = pvlib.location.Location(${site.lat}, ${site.lon}, "UTC", ${site.altitude})
t = pd.DatetimeIndex(["${iso}"], tz="UTC")
sp = loc.get_solarposition(t)                      # NREL SPA, pressure from altitude, 12 °C
dni_extra = irradiance.get_extra_radiation(t)      # Spencer
cs = loc.get_clearsky(t, model="ineichen", linke_turbidity=${params.linkeTurbidity}, dni_extra=dni_extra)
poa = irradiance.get_total_irradiance(${o.tilt}, ${o.azimuth}, sp.apparent_zenith, sp.azimuth,
        cs.dni, cs.ghi, cs.dhi, dni_extra=dni_extra, model="${params.transposition}", albedo=${params.albedo})
print(sp[["zenith", "apparent_zenith", "azimuth"]].T)
print(cs.T)
print(poa.T)
`;
}
