import fixtures from "../__fixtures__/pvlib.json";
import { clearSkySource, type WeatherYear } from "../weather";
import { DEFAULT_PARAMS, type ModelParams, type Site } from "../types";

export { fixtures };
export const params: ModelParams = { ...DEFAULT_PARAMS, linkeTurbidity: fixtures.meta.linkeTurbidity, albedo: fixtures.meta.albedo };
export type SiteName = keyof typeof fixtures.sites;
export const siteNames = Object.keys(fixtures.sites) as SiteName[];
export const siteOf = (n: SiteName): Site => {
  const s = fixtures.sites[n];
  return { lat: s.lat, lon: s.lon, altitude: s.altitude };
};
const cache = new Map<string, Promise<WeatherYear>>();
export function yearFor(n: SiteName, p: ModelParams = params): Promise<WeatherYear> {
  const k = `${n}|${p.linkeTurbidity}`;
  if (!cache.has(k)) cache.set(k, clearSkySource.year(siteOf(n), p));
  return cache.get(k)!;
}
/** expect |a − b| ≤ abs + rel·|b| */
export function close(a: number, b: number, rel: number, abs = 0) {
  expect(Math.abs(a - b), `got ${a}, expected ${b}`).toBeLessThanOrEqual(abs + rel * Math.abs(b));
}
