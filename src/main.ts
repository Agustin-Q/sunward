import "./ui/styles.css";
import {
  WEATHER_SOURCES, compare, createTracer, energyKWh, getSource, hourRows, optimize,
  pvlibSnippet, rowsToCsv, simulateYear, textbookSun, traceHour,
  type ModelParams, type OptimizeResult, type Orientation, type Site, type TraceStep,
  type WeatherYear, type YearResult,
} from "./core";
import { createCompass, renderTiltView } from "./ui/compass";
import { createCharts } from "./ui/charts";
import { createHeatmap } from "./ui/heatmap";
import { renderDayTable, renderSteps } from "./ui/debugView";
import { compassPoint, dateToHourIndex, fmtNum, fmtSigned, readNum } from "./ui/helpers";
import type { SiteMap } from "./ui/map";
import { DEFAULTS, persist, readStored, resolveInitialState, shareUrl, type AppState } from "./ui/appState";
import ComputeWorker from "./worker?worker&inline";

// ---------- state ----------
// Settings live in ./ui/appState: defaults ← localStorage ← query string.
// Every change goes through save(), which writes localStorage and mirrors the
// settings into the URL so the address bar is always a shareable link.
const state: AppState = resolveInitialState(readStored(), location.search);
const save = () => persist(state);
const inArtifact = typeof (window as unknown as { claude?: { use?: unknown } }).claude?.use === "function";

interface Computed { weather: WeatherYear; opt: OptimizeResult; optSteps: TraceStep[]; optYear: YearResult; youYear: YearResult }
let computed: Computed | null = null;

// ---------- dom ----------
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const inputs = {
  lat: $<HTMLInputElement>("lat"), lon: $<HTMLInputElement>("lon"), alt: $<HTMLInputElement>("alt"),
  tilt: $<HTMLInputElement>("tilt"), az: $<HTMLInputElement>("az"),
  kwp: $<HTMLInputElement>("kwp"), pr: $<HTMLInputElement>("pr"),
  tl: $<HTMLInputElement>("tl"), albedo: $<HTMLInputElement>("albedo"),
  source: $<HTMLSelectElement>("source"), transp: $<HTMLSelectElement>("transp"),
  dbgDate: $<HTMLInputElement>("dbg-date"), dbgHour: $<HTMLInputElement>("dbg-hour"), dbgOrient: $<HTMLSelectElement>("dbg-orient"),
};
const locMsg = $("loc-msg");
const setMsg = (el: HTMLElement, text: string, error = false) => { el.textContent = text; el.classList.toggle("error", error); };

// ---------- widgets ----------
const compass = createCompass($<SVGSVGElement & HTMLElement>("compass") as unknown as SVGSVGElement, (az) => setYou({ azimuth: az }));
const charts = createCharts($<HTMLCanvasElement>("chart-monthly"), $<HTMLCanvasElement>("chart-loss"));
const heat = createHeatmap($<HTMLCanvasElement>("heatmap"), $("heat-tip"), $("heat-legend"), (o) => setYou(o));
let siteMap: SiteMap | null = null;
let mapAvailable = true;

function mapUnavailable() {
  mapAvailable = false;
  $("map").hidden = true;
  $("map-fallback").hidden = false;
}

async function initMap() {
  try {
    const { createSiteMap } = await import("./ui/map");
    siteMap = createSiteMap($("map"), state.site.lat, state.site.lon, {
      onMove: (lat, lon) => setSite({ lat, lon }, { recenter: false, lookupAlt: true }),
      onRotate: (az) => setYou({ azimuth: az }),
      onUnavailable: mapUnavailable,
    });
  } catch {
    mapUnavailable();
  }
}

// ---------- setters ----------
function setYou(o: Partial<Orientation>) {
  if (o.tilt !== undefined) state.you.tilt = Math.round(Math.min(90, Math.max(0, o.tilt)));
  if (o.azimuth !== undefined) state.you.azimuth = Math.round(((o.azimuth % 360) + 360) % 360);
  save();
  refreshDerived();
}

let altAbort: AbortController | null = null;
async function setSite(p: Partial<Site>, opts: { recenter?: boolean; lookupAlt?: boolean } = {}) {
  state.site = { ...state.site, ...p };
  state.siteIsExample = false;
  if (opts.recenter !== false) siteMap?.setSite(state.site.lat, state.site.lon, true);
  writeInputs();
  save();
  scheduleRecompute();
  if (opts.lookupAlt && mapAvailable) {
    altAbort?.abort();
    altAbort = new AbortController();
    try {
      const { lookupAltitude } = await import("./ui/map");
      const alt = await lookupAltitude(state.site.lat, state.site.lon, altAbort.signal);
      state.site.altitude = alt;
      writeInputs();
      save();
      scheduleRecompute();
    } catch (e) {
      if ((e as Error).name !== "AbortError") setMsg(locMsg, "Could not look up the altitude. Enter it by hand if you know it.", true);
    }
  }
}

function writeInputs() {
  inputs.lat.value = state.site.lat.toFixed(5);
  inputs.lon.value = state.site.lon.toFixed(5);
  inputs.alt.value = String(Math.round(state.site.altitude));
  inputs.tilt.value = String(state.you.tilt);
  inputs.az.value = String(state.you.azimuth);
  inputs.kwp.value = String(state.sys.kWp);
  inputs.pr.value = String(state.sys.performanceRatio);
  inputs.tl.value = String(state.params.linkeTurbidity);
  inputs.albedo.value = String(state.params.albedo);
  inputs.transp.value = state.params.transposition;
  inputs.source.value = state.sourceId;
  inputs.dbgDate.value = state.dbgDate;
  inputs.dbgHour.value = String(state.dbgHour);
  inputs.dbgOrient.value = state.dbgOrient;
}

// ---------- compute ----------
let worker: Worker | null = null;
try { worker = new ComputeWorker(); } catch { worker = null; }
let reqId = 0;
let timer: number | undefined;
function scheduleRecompute() {
  window.clearTimeout(timer);
  timer = window.setTimeout(recompute, 350);
}

async function computeInline(site: Site, params: ModelParams, sourceId: string) {
  await new Promise((r) => setTimeout(r, 30)); // let the busy notice paint
  const weather = await getSource(sourceId).year(site, params);
  const t = createTracer();
  const opt = optimize(weather, params, {}, t);
  return { weather, opt, optSteps: t.steps };
}

function computeInWorker(site: Site, params: ModelParams, sourceId: string): Promise<{ weather: WeatherYear; opt: OptimizeResult; optSteps: TraceStep[] }> {
  return new Promise((resolve, reject) => {
    const id = ++reqId;
    const onMsg = (e: MessageEvent) => {
      if (e.data.id !== id) return;
      worker!.removeEventListener("message", onMsg);
      if (e.data.error) reject(new Error(e.data.error));
      else resolve(e.data);
    };
    worker!.addEventListener("message", onMsg);
    worker!.addEventListener("error", (err) => reject(err), { once: true });
    worker!.postMessage({ id, site, params, sourceId });
  });
}

let computeSeq = 0;
async function recompute() {
  const seq = ++computeSeq;
  const site = { ...state.site }, params = { ...state.params }, sourceId = state.sourceId;
  $("busy").hidden = false;
  try {
    let r;
    try {
      r = worker ? await computeInWorker(site, params, sourceId) : await computeInline(site, params, sourceId);
    } catch (e) {
      if (!worker) throw e;
      worker = null; // worker blocked or failed: fall back to the main thread
      r = await computeInline(site, params, sourceId);
    }
    if (seq !== computeSeq) return;
    const optYear = simulateYear(r.weather, r.opt.best, params);
    computed = { ...r, optYear, youYear: optYear };
    refreshDerived();
  } catch (e) {
    setMsg(locMsg, `Calculation failed: ${(e as Error).message}`, true);
  } finally {
    if (seq === computeSeq) $("busy").hidden = true;
  }
}

// ---------- render ----------
function refreshDerived() {
  inputs.tilt.value = String(state.you.tilt);
  inputs.az.value = String(state.you.azimuth);
  $("tilt-out").textContent = `${state.you.tilt}°`;
  $("az-out").textContent = `${state.you.azimuth}° ${compassPoint(state.you.azimuth)}`;
  $("dial-read").textContent = `${state.you.azimuth}° ${compassPoint(state.you.azimuth)}`;
  const opt = computed?.opt.best ?? null;
  compass.update(state.you.azimuth, opt ? opt.azimuth : null);
  renderTiltView($("tilt-view") as unknown as SVGSVGElement, state.you.tilt, opt ? opt.tilt : null);
  siteMap?.setArrows(state.you.azimuth, opt ? opt.azimuth : null);
  if (!computed) return;

  computed.youYear = simulateYear(computed.weather, state.you, state.params);
  const { optYear, youYear } = computed;
  const cmp = compare(youYear, optYear);
  const eYou = energyKWh(youYear.annual, state.sys), eOpt = energyKWh(optYear.annual, state.sys);

  $("s-opt").textContent = `${optYear.orientation.tilt}° · ${Math.round(optYear.orientation.azimuth)}°`;
  $("s-opt-sub").textContent = `tilt · facing ${compassPoint(optYear.orientation.azimuth)}\n${fmtNum(optYear.annual)} kWh/m²/yr`;
  $("s-you").textContent = `${fmtNum(youYear.annual)}`;
  $("s-you-sub").textContent = `kWh/m²/yr at ${state.you.tilt}° · ${state.you.azimuth}° ${compassPoint(state.you.azimuth)}`;
  const lossEl = $("s-loss");
  lossEl.textContent = `${fmtNum(cmp.lossAnnualPct, 1)}%`;
  lossEl.className = `stat-value ${cmp.lossAnnualPct < 3 ? "loss-low" : cmp.lossAnnualPct > 10 ? "loss-high" : ""}`;
  $("s-loss-sub").textContent = `${fmtNum(cmp.lossAnnual)} kWh/m²/yr · Δtilt ${fmtSigned(cmp.deviation.tilt, 0)}° · Δaz ${fmtSigned(cmp.deviation.azimuth, 0)}°`;
  $("s-kwh").textContent = fmtNum(eYou);
  $("s-kwh-sub").textContent = `kWh with ${state.sys.kWp} kWp, PR ${state.sys.performanceRatio}\n${fmtNum(eOpt - eYou)} kWh/yr less than optimal`;

  const src = getSource(state.sourceId);
  $("caveat").textContent = `${state.siteIsExample ? "Example location: Madrid. Set yours on the left. " : ""}${
    src.id === "clearsky" ? "Clear-sky data ignores clouds, so totals run high (often 20–35% in sunny climates, more in cloudy ones). The optimal angles and your loss percentage are much more reliable than the absolute numbers." : src.description}`;

  // charts
  const u = state.unit;
  const conv = (y: YearResult) => (u === "month" ? y.monthly : u === "day" ? y.dailyAvg : y.monthly.map((m) => m * state.sys.kWp * state.sys.performanceRatio));
  const unitLabel = u === "month" ? "kWh/m²" : u === "day" ? "kWh/m²/day" : "kWh";
  charts.update(conv(optYear), conv(youYear), unitLabel, u === "day" ? 2 : 0, cmp.lossMonthlyPct);

  // table
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const kwh = (x: number) => x * state.sys.kWp * state.sys.performanceRatio;
  const rows = months.map((m, k) => `<tr><td>${m}</td><td>${optYear.monthly[k].toFixed(1)}</td><td>${youYear.monthly[k].toFixed(1)}</td><td>${optYear.dailyAvg[k].toFixed(2)}</td><td>${youYear.dailyAvg[k].toFixed(2)}</td><td>${fmtSigned(cmp.lossMonthlyPct[k], 1)}%</td><td>${fmtNum(kwh(youYear.monthly[k]))}</td></tr>`).join("");
  ($("tbl-monthly") as HTMLTableElement).innerHTML = `<thead><tr><th>Month</th><th>Optimal<br>kWh/m²</th><th>Yours<br>kWh/m²</th><th>Optimal<br>per day</th><th>Yours<br>per day</th><th>Loss</th><th>Yours<br>kWh</th></tr></thead><tbody>${rows}</tbody>
    <tfoot><tr><td>Year</td><td>${optYear.annual.toFixed(0)}</td><td>${youYear.annual.toFixed(0)}</td><td>${(optYear.annual / 365).toFixed(2)}</td><td>${(youYear.annual / 365).toFixed(2)}</td><td>${fmtSigned(cmp.lossAnnualPct, 1)}%</td><td>${fmtNum(eYou)}</td></tr></tfoot>`;

  if (state.tab === "heatmap") heat.draw(computed.opt.heatmap, computed.opt.annual, state.you, computed.opt.best);
  if (state.tab === "debug") scheduleDebug();
}

// ---------- debug view ----------
let dbgTimer: number | undefined;
function scheduleDebug() {
  window.clearTimeout(dbgTimer);
  dbgTimer = window.setTimeout(renderDebug, 120);
}
async function renderDebug() {
  if (!computed) return;
  const o = state.dbgOrient === "opt" ? computed.opt.best : state.you;
  const idx = Math.min(8759, Math.max(0, dateToHourIndex(state.dbgDate, state.dbgHour)));
  const epoch = computed.weather.epochMs[idx];
  const src = getSource(state.sourceId);
  const tr = await traceHour(src, state.site, state.params, o, epoch);
  renderSteps($("dbg-steps"), tr.steps);
  const tb = textbookSun(epoch, state.site);
  $("dbg-solar").textContent = `Local solar time ≈ ${Math.floor(tb.solarTimeH)}:${String(Math.round((tb.solarTimeH % 1) * 60)).padStart(2, "0")}`;
  $("pvlib-code").textContent = pvlibSnippet(state.site, state.params, o, epoch);
  const dayStart = idx - (idx % 24);
  renderDayTable($("tbl-day") as HTMLTableElement, hourRows(computed.weather, o, state.params, dayStart, dayStart + 24), idx - dayStart);

  const t = createTracer();
  const yy = simulateYear(computed.weather, state.you, state.params, t);
  const oy = simulateYear(computed.weather, computed.opt.best, state.params, t);
  for (const s of computed.optSteps) t.steps.push(s);
  compare(yy, oy, t);
  t.group("Electricity");
  energyKWh(yy.annual, state.sys, t, "Yours, per year");
  energyKWh(oy.annual, state.sys, t, "Optimal, per year");
  renderSteps($("dbg-totals"), t.steps);
}

async function downloadCsv() {
  if (!computed) return;
  const btn = $<HTMLButtonElement>("btn-csv");
  const csv = rowsToCsv(hourRows(computed.weather, state.dbgOrient === "opt" ? computed.opt.best : state.you, state.params));
  const filename = `sunward-hourly-${state.site.lat.toFixed(3)}_${state.site.lon.toFixed(3)}.csv`;
  const claude = (window as unknown as { claude?: { use(n: string): Promise<{ save(r: { filename: string; data: string }): Promise<unknown> } | null> } }).claude;
  if (claude?.use) {
    const dl = await claude.use("downloads");
    if (!dl) { btn.disabled = true; btn.textContent = "Download unavailable here"; return; }
    try { await dl.save({ filename, data: csv }); } catch { /* declined or unavailable */ }
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- events ----------
function setTab(tab: AppState["tab"]) {
  state.tab = tab;
  save();
  for (const b of document.querySelectorAll<HTMLButtonElement>(".tabs button")) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
  for (const v of ["results", "heatmap", "debug"]) $(`view-${v}`).hidden = v !== tab;
  if (computed && tab === "heatmap") heat.draw(computed.opt.heatmap, computed.opt.annual, state.you, computed.opt.best);
  if (tab === "debug") scheduleDebug();
  if (tab === "results") charts.retheme();
}
for (const b of document.querySelectorAll<HTMLButtonElement>(".tabs button")) b.addEventListener("click", () => setTab(b.dataset.tab as AppState["tab"]));
for (const b of document.querySelectorAll<HTMLButtonElement>(".seg button")) {
  b.addEventListener("click", () => {
    state.unit = b.dataset.unit as AppState["unit"];
    for (const x of document.querySelectorAll<HTMLButtonElement>(".seg button")) x.setAttribute("aria-checked", String(x === b));
    save();
    refreshDerived();
  });
}

const onSiteInput = () => {
  const lat = readNum(inputs.lat.value, -89.9, 89.9, state.site.lat);
  const lon = readNum(inputs.lon.value, -180, 180, state.site.lon);
  const altitude = readNum(inputs.alt.value, -400, 8800, state.site.altitude);
  const moved = lat !== state.site.lat || lon !== state.site.lon;
  state.site = { lat, lon, altitude };
  state.siteIsExample = false;
  if (moved) siteMap?.setSite(lat, lon, true);
  save();
  scheduleRecompute();
};
for (const el of [inputs.lat, inputs.lon, inputs.alt]) el.addEventListener("change", onSiteInput);

inputs.tilt.addEventListener("input", () => setYou({ tilt: +inputs.tilt.value }));
inputs.az.addEventListener("input", () => setYou({ azimuth: +inputs.az.value }));
const onSys = () => {
  state.sys = { kWp: readNum(inputs.kwp.value, 0, 10000, state.sys.kWp), performanceRatio: readNum(inputs.pr.value, 0.1, 1, state.sys.performanceRatio) };
  save();
  refreshDerived();
};
inputs.kwp.addEventListener("input", onSys);
inputs.pr.addEventListener("input", onSys);
const onModel = () => {
  state.params = {
    linkeTurbidity: readNum(inputs.tl.value, 1, 8, state.params.linkeTurbidity),
    albedo: readNum(inputs.albedo.value, 0, 1, state.params.albedo),
    transposition: inputs.transp.value as ModelParams["transposition"],
  };
  save();
  scheduleRecompute();
};
for (const el of [inputs.tl, inputs.albedo]) el.addEventListener("change", onModel);
inputs.transp.addEventListener("change", onModel);
inputs.source.addEventListener("change", () => {
  const s = getSource(inputs.source.value);
  if (!s.available) { inputs.source.value = state.sourceId; return; }
  state.sourceId = s.id;
  $("source-desc").textContent = s.description;
  save();
  scheduleRecompute();
});
for (const el of [inputs.dbgDate, inputs.dbgHour, inputs.dbgOrient]) {
  el.addEventListener("change", () => {
    state.dbgDate = inputs.dbgDate.value || DEFAULTS.dbgDate;
    state.dbgHour = readNum(inputs.dbgHour.value, 0, 23, 12);
    state.dbgOrient = inputs.dbgOrient.value as AppState["dbgOrient"];
    save();
    scheduleDebug();
  });
}
$("btn-use-opt").addEventListener("click", () => computed && setYou({ ...computed.opt.best }));
$("btn-csv").addEventListener("click", downloadCsv);
const shareBtn = $<HTMLButtonElement>("btn-share");
if (inArtifact) {
  // Inside a claude.ai Artifact the query string never reaches the page, so links can't carry settings.
  shareBtn.hidden = true;
} else {
  shareBtn.addEventListener("click", async () => {
    const url = shareUrl(state);
    try {
      await navigator.clipboard.writeText(url);
      shareBtn.textContent = "Link copied";
    } catch {
      shareBtn.textContent = "Copy it from the address bar";
    }
    setTimeout(() => (shareBtn.textContent = "Copy share link"), 2500);
  });
}
$("btn-pvlib").addEventListener("click", async () => {
  const code = $("pvlib-code");
  code.hidden = false;
  try {
    await navigator.clipboard.writeText(code.textContent ?? "");
    setMsg($("pvlib-msg"), "Copied. Paste it into Python to check this hour independently.");
  } catch {
    const range = document.createRange();
    range.selectNodeContents(code);
    const sel = getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    setMsg($("pvlib-msg"), "Copying is blocked here. The code is selected below; copy it by hand.");
  }
});

$("btn-geo").addEventListener("click", () => {
  if (!("geolocation" in navigator)) return setMsg(locMsg, "This browser has no location access. Enter coordinates instead.", true);
  setMsg(locMsg, "Finding your location…");
  navigator.geolocation.getCurrentPosition(
    (p) => {
      setMsg(locMsg, `Located within about ${Math.round(p.coords.accuracy)} m.`);
      const alt = p.coords.altitude;
      setSite({ lat: p.coords.latitude, lon: p.coords.longitude, ...(alt != null ? { altitude: Math.round(alt) } : {}) }, { lookupAlt: alt == null });
    },
    (err) => setMsg(locMsg, err.code === err.PERMISSION_DENIED ? "Location access was refused here. Enter coordinates, or open the standalone file in a normal browser." : "Could not get your location. Enter coordinates instead.", true),
    { enableHighAccuracy: true, timeout: 15000 },
  );
});
$("search-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = ($("search") as HTMLInputElement).value.trim();
  if (!q) return;
  setMsg(locMsg, "Searching…");
  try {
    const { geocode } = await import("./ui/map");
    const r = await geocode(q);
    if (!r) return setMsg(locMsg, "No match found. Try a fuller address or a city name.", true);
    setMsg(locMsg, r.name);
    setSite({ lat: r.lat, lon: r.lon }, { lookupAlt: true });
  } catch {
    setMsg(locMsg, "Address search needs internet access to OpenStreetMap, which is blocked here. Enter coordinates instead.", true);
  }
});

// re-theme charts when the colour scheme changes
const retheme = () => { charts.retheme(); if (computed && state.tab === "heatmap") heat.redraw(); };
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", retheme);
new MutationObserver(retheme).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

// ---------- boot ----------
for (const s of WEATHER_SOURCES) {
  const o = document.createElement("option");
  o.value = s.id;
  o.textContent = s.label;
  o.disabled = !s.available;
  inputs.source.appendChild(o);
}
$("source-desc").textContent = getSource(state.sourceId).description;
for (const x of document.querySelectorAll<HTMLButtonElement>(".seg button")) x.setAttribute("aria-checked", String(x.dataset.unit === state.unit));
writeInputs();
setTab(state.tab);
refreshDerived();
initMap();
recompute();
