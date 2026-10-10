/// <reference lib="webworker" />
import { createTracer, getSource, optimize, type ModelParams, type Site } from "./core";

export interface ComputeRequest { id: number; site: Site; params: ModelParams; sourceId: string }

self.onmessage = async (e: MessageEvent<ComputeRequest>) => {
  const { id, site, params, sourceId } = e.data;
  try {
    const weather = await getSource(sourceId).year(site, params);
    const t = createTracer();
    const opt = optimize(weather, params, {}, t);
    const transfer = [weather.epochMs, weather.month, weather.apparentZenith, weather.azimuth, weather.ghi, weather.dni, weather.dhi, weather.dniExtra].map((a) => a.buffer);
    (self as unknown as Worker).postMessage({ id, weather, opt, optSteps: t.steps }, transfer);
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String((err as Error)?.message ?? err) });
  }
};
