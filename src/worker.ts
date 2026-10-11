/// <reference lib="webworker" />
import { buildShading, createTracer, getSource, optimize, seriesSource, type HorizonProfile, type HourlySeries, type ModelParams, type Site } from "./core";

export interface ComputeRequest { id: number; site: Site; params: ModelParams; sourceId: string; horizon: HorizonProfile | null; series?: HourlySeries | null }

self.onmessage = async (e: MessageEvent<ComputeRequest>) => {
  const { id, site, params, sourceId, horizon, series } = e.data;
  try {
    const src = series ? seriesSource(sourceId, series.label, "", series) : getSource(sourceId);
    const weather = await src.year(site, params);
    const t = createTracer();
    const shading = horizon ? buildShading(weather, horizon) : undefined;
    const opt = optimize(weather, params, { shading }, t);
    const transfer = [weather.epochMs, weather.month, weather.apparentZenith, weather.azimuth, weather.ghi, weather.dni, weather.dhi, weather.dniExtra].map((a) => a.buffer);
    (self as unknown as Worker).postMessage({ id, weather, opt, optSteps: t.steps }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
