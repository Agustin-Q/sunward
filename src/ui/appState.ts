/**
 * Application settings: defaults, validation, localStorage persistence and
 * query-string encoding for shareable links. Pure (no DOM) except the thin
 * storage wrappers, so it is unit-tested.
 *
 * Load order: defaults ← localStorage ← query string (the link wins, so a
 * shared link shows exactly what the sender saw). Every change is saved to
 * localStorage and mirrored into the URL with history.replaceState.
 */
import { DEFAULT_PARAMS, DEFAULT_SYSTEM, WEATHER_SOURCES, type ModelParams, type Orientation, type Site, type SystemSpec } from "../core";

export type Unit = "month" | "day" | "kwh";
export type Tab = "results" | "heatmap" | "debug";
export type DebugOrientation = "you" | "opt";

export interface AppState {
  site: Site;
  /** True until the user sets a location (shows the "example location" note). */
  siteIsExample: boolean;
  params: ModelParams;
  sourceId: string;
  you: Orientation;
  sys: SystemSpec;
  unit: Unit;
  tab: Tab;
  dbgDate: string;
  dbgHour: number;
  dbgOrient: DebugOrientation;
}

export const DEFAULTS: AppState = {
  site: { lat: 40.4168, lon: -3.7038, altitude: 667 },
  siteIsExample: true,
  params: { ...DEFAULT_PARAMS },
  sourceId: "clearsky",
  you: { tilt: 20, azimuth: 160 },
  sys: { ...DEFAULT_SYSTEM },
  unit: "month",
  tab: "results",
  dbgDate: "2025-06-21",
  dbgHour: 12,
  dbgOrient: "you",
};

export const STORE_KEY = "sunward.v1";

const num = (v: unknown, lo: number, hi: number, fb: number): number => {
  const x = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fb;
};
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fb: T): T => (allowed.includes(v as T) ? (v as T) : fb);
const isDate2025 = (v: unknown): v is string => typeof v === "string" && /^2025-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v);
const wrapAz = (a: number) => ((Math.round(a) % 360) + 360) % 360;
const AVAILABLE_SOURCES = WEATHER_SOURCES.filter((s) => s.available).map((s) => s.id);

/** Validate and complete any (possibly partial, possibly hostile) settings object. */
export function sanitize(raw: unknown, base: AppState = DEFAULTS): AppState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const site = r.site ?? {}, params = r.params ?? {}, you = r.you ?? {}, sys = r.sys ?? {};
  return {
    site: {
      lat: num(site.lat, -89.9, 89.9, base.site.lat),
      lon: num(site.lon, -180, 180, base.site.lon),
      altitude: num(site.altitude, -400, 8800, base.site.altitude),
    },
    siteIsExample: typeof r.siteIsExample === "boolean" ? r.siteIsExample : base.siteIsExample,
    params: {
      linkeTurbidity: num(params.linkeTurbidity, 1, 8, base.params.linkeTurbidity),
      albedo: num(params.albedo, 0, 1, base.params.albedo),
      transposition: oneOf(params.transposition, ["haydavies", "isotropic"] as const, base.params.transposition),
    },
    sourceId: oneOf(r.sourceId, AVAILABLE_SOURCES, AVAILABLE_SOURCES.includes(base.sourceId) ? base.sourceId : "clearsky"),
    you: {
      tilt: Math.round(num(you.tilt, 0, 90, base.you.tilt)),
      azimuth: wrapAz(num(you.azimuth, -720, 720, base.you.azimuth)),
    },
    sys: {
      kWp: num(sys.kWp, 0, 10000, base.sys.kWp),
      performanceRatio: num(sys.performanceRatio, 0.1, 1, base.sys.performanceRatio),
    },
    unit: oneOf(r.unit, ["month", "day", "kwh"] as const, base.unit),
    tab: oneOf(r.tab, ["results", "heatmap", "debug"] as const, base.tab),
    dbgDate: isDate2025(r.dbgDate) ? r.dbgDate : base.dbgDate,
    dbgHour: Math.round(num(r.dbgHour, 0, 23, base.dbgHour)),
    dbgOrient: oneOf(r.dbgOrient, ["you", "opt"] as const, base.dbgOrient),
  };
}

/**
 * Query-string keys. Short, stable names: changing one breaks shared links,
 * so add new keys instead of renaming.
 */
export const QUERY_KEYS = {
  lat: "lat", lon: "lon", alt: "alt",
  tilt: "tilt", az: "az",
  kwp: "kwp", pr: "pr",
  tl: "tl", albedo: "alb", transp: "tm", source: "src",
  unit: "unit", tab: "tab",
  dbgDate: "dd", dbgHour: "dh", dbgOrient: "do",
} as const;

const r5 = (x: number) => String(Number(x.toFixed(5)));
const r2 = (x: number) => String(Number(x.toFixed(2)));

/** Encode settings as a query string (without the leading "?"). */
export function toQuery(s: AppState): string {
  const q = new URLSearchParams();
  const K = QUERY_KEYS;
  q.set(K.lat, r5(s.site.lat));
  q.set(K.lon, r5(s.site.lon));
  q.set(K.alt, String(Math.round(s.site.altitude)));
  q.set(K.tilt, String(s.you.tilt));
  q.set(K.az, String(s.you.azimuth));
  q.set(K.kwp, r2(s.sys.kWp));
  q.set(K.pr, r2(s.sys.performanceRatio));
  q.set(K.tl, r2(s.params.linkeTurbidity));
  q.set(K.albedo, r2(s.params.albedo));
  q.set(K.transp, s.params.transposition);
  q.set(K.source, s.sourceId);
  q.set(K.unit, s.unit);
  q.set(K.tab, s.tab);
  q.set(K.dbgDate, s.dbgDate);
  q.set(K.dbgHour, String(s.dbgHour));
  q.set(K.dbgOrient, s.dbgOrient);
  return q.toString();
}

/**
 * Decode a query string into a partial settings object (only keys present).
 * Unknown keys are ignored; values are validated later by sanitize().
 */
export function fromQuery(search: string): Record<string, any> {
  const q = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const K = QUERY_KEYS;
  const out: Record<string, any> = {};
  const has = (k: string) => q.has(k) && q.get(k) !== "";
  const site: Record<string, string> = {}, you: Record<string, string> = {}, sys: Record<string, string> = {}, params: Record<string, string> = {};
  if (has(K.lat)) site.lat = q.get(K.lat)!;
  if (has(K.lon)) site.lon = q.get(K.lon)!;
  if (has(K.alt)) site.altitude = q.get(K.alt)!;
  if (has(K.tilt)) you.tilt = q.get(K.tilt)!;
  if (has(K.az)) you.azimuth = q.get(K.az)!;
  if (has(K.kwp)) sys.kWp = q.get(K.kwp)!;
  if (has(K.pr)) sys.performanceRatio = q.get(K.pr)!;
  if (has(K.tl)) params.linkeTurbidity = q.get(K.tl)!;
  if (has(K.albedo)) params.albedo = q.get(K.albedo)!;
  if (has(K.transp)) params.transposition = q.get(K.transp)!;
  if (Object.keys(site).length) { out.site = site; out.siteIsExample = false; }
  if (Object.keys(you).length) out.you = you;
  if (Object.keys(sys).length) out.sys = sys;
  if (Object.keys(params).length) out.params = params;
  if (has(K.source)) out.sourceId = q.get(K.source);
  if (has(K.unit)) out.unit = q.get(K.unit);
  if (has(K.tab)) out.tab = q.get(K.tab);
  if (has(K.dbgDate)) out.dbgDate = q.get(K.dbgDate);
  if (has(K.dbgHour)) out.dbgHour = q.get(K.dbgHour);
  if (has(K.dbgOrient)) out.dbgOrient = q.get(K.dbgOrient);
  return out;
}

/** Deep-merge a partial (e.g. from the query string) over a full state, then validate. */
export function mergeState(base: AppState, partial: Record<string, any>): AppState {
  return sanitize({
    ...base,
    ...partial,
    site: { ...base.site, ...(partial.site ?? {}) },
    params: { ...base.params, ...(partial.params ?? {}) },
    you: { ...base.you, ...(partial.you ?? {}) },
    sys: { ...base.sys, ...(partial.sys ?? {}) },
  }, base);
}

/** defaults ← stored JSON ← query string. */
export function resolveInitialState(storedJson: string | null, search: string): AppState {
  let stored: AppState = structuredClone(DEFAULTS);
  if (storedJson) {
    try { stored = sanitize(JSON.parse(storedJson)); } catch { /* corrupt storage: use defaults */ }
  }
  return mergeState(stored, fromQuery(search));
}

// ---- thin browser wrappers (not unit-tested; every access guarded) ----

export function readStored(): string | null {
  try { return localStorage.getItem(STORE_KEY); } catch { return null; }
}

export function persist(s: AppState): void {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch { /* storage blocked */ }
  try {
    const url = new URL(location.href);
    url.search = toQuery(s);
    history.replaceState(history.state, "", url);
  } catch { /* sandboxed frame: URL cannot change */ }
}

/** Full shareable link for the current settings. */
export function shareUrl(s: AppState, href: string = location.href): string {
  const url = new URL(href);
  url.search = toQuery(s);
  url.hash = "";
  return url.toString();
}
