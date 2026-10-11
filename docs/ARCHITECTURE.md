# Architecture

## Data flow

```
settings (AppState) ──► ensureHorizon(): memory → localStorage cache → AWS Terrain Tiles (→ Open-Meteo backup)
   │                       └─ computeHorizon(site, panelHeight, sampler) → 72-value profile
   ├──────────────────► worker.ts ──► WeatherSource.year(site, params)    8,760 hours of
   │                       │            └─ clearSkyHour(): SPA → air mass  sun position +
   │                       │               → I₀ → Ineichen                 GHI/DNI/DHI/I₀
   │                       ├──► buildShading(weather, profile) (when terrain is on)
   │                       └──► optimize(weather, {shading}) ─► best orientation + heatmap + trace
   ▼
main.ts ──► simulateYear(weather, yours/optimal) ─► monthly / daily / annual
        ──► compare() ─► deviation + loss      energyKWh() ─► kWh
        ──► render: stats, Chart.js charts, table, heatmap canvas, compass, map arrows
        ──► debug: traceHour() (same functions, Tracer on), hourRows(), CSV, pvlib snippet
```

- **Changing location or model settings** rebuilds the weather year and reruns the optimizer, in a
  Web Worker (about 1 s, debounced by 350 ms).
- **Changing orientation or system size** only reruns `simulateYear` for "yours", on the main thread
  (a few ms).
- If the worker can't start (blocked blob workers), the same code runs on the main thread.

## Core (`src/core/`, pure)

| Module | Responsibility |
|---|---|
| `types.ts` | `Site`, `Orientation`, `ModelParams`, `DEFAULT_PARAMS` |
| `trace.ts` | `Tracer` / `TraceStep`, `fmt()`, `traced()` (test helper) |
| `math.ts` | degree trig, `wrap360`, `angleDiff`, `dayOfYearUTC`, days per month |
| `atmosphere.ts` | pressure from altitude, relative and absolute air mass |
| `extraterrestrial.ts` | Spencer I₀ |
| `solarPosition.ts` | wrapper around `@yogur/solpos` (NREL SPA) |
| `clearsky.ts` | Ineichen-Perez |
| `planeOfArray.ts` | angle of incidence, beam, Hay-Davies / isotropic, ground, total; optional `ShadeFactors` |
| `horizon.ts` | `HorizonProfile`, interpolation, sun visibility, Dozier sky view factor, `traceShade`, URL encode/decode |
| `shading.ts` | `buildShading(weather, profile)`: per-hour visibility plus the ground's sky view |
| `terrain.ts` | ray casting over elevation data with an injected `ElevationSampler`; great-circle, curvature |
| `weather.ts` | `WeatherSource` interface, `clearSkySource`, `nasaPowerDescriptor`, registry `WEATHER_SOURCES` |
| `weatherData.ts` | data-backed sources: `parseNasaPower`, `averageYears`, `seriesHour` (traced), `seriesSource`, compact encode/decode |
| `simulate.ts` | `simulateYear(w, o, params, t?, shading?)` → `YearResult` (monthly, dailyAvg, annual, components) |
| `optimize.ts` | grid + refinement, heatmap; `opts.shading` |
| `compare.ts` | deviation, monthly/annual loss |
| `energy.ts` | kWh from kWp and PR |
| `textbook.ts` | approximate sun position for learning (debug only) |
| `debug.ts` | `traceHour(…, horizon?)`, `hourRows(…, shading?)`, `rowsToCsv()`, `pvlibSnippet()` |

### Tracing contract

Each step function accepts `t?: Tracer` and calls `t?.add({ key, label, symbol, formula,
substituted, value, unit })`. `t.group(name)` sets the section heading. Keys are stable (for
example `clearsky.ghi`, `poa.global`). Tests assert that traced values equal the returned values.

### Data-backed weather sources

The UI downloads the data (`ui/nasaPower.ts`, `ensureWeather()` in `main.ts`) and passes an
`HourlySeries` to the worker. The worker builds the year with `seriesSource()`. The core stays
free of network calls.

### Adding a weather source

1. Implement `WeatherSource`:
   - `hour(site, params, epochMs, t?)` returns `{ sun, irr, dniExtra }`, tracing where the numbers
     came from
   - `year(site, params)` returns a `WeatherYear`; `buildYear()` helps
2. Set `available: true` in `WEATHER_SOURCES`.
3. If it fetches from the network, put the fetch outside `src/core/` (or inject a fetcher) so core
   stays pure and testable. PVGIS doesn't allow browser CORS, so it needs a proxy; NASA POWER does.
4. Add tests with a recorded response fixture.

## UI (`src/ui/`)

| Module | Responsibility |
|---|---|
| `appState.ts` | `AppState`, `DEFAULTS`, `sanitize()`, `toQuery()` / `fromQuery()`, `mergeState()`, `resolveInitialState()`, `persist()`, `shareUrl()` |
| `nasaPower.ts` | NASA POWER download (one year per request, in sequence) and localStorage cache |
| `terrainTiles.ts` | primary `ElevationSampler`: Terrarium tiles, zoom by distance, bilinear sampling, tile maths |
| `elevation.ts` | backup `openMeteoSampler()`: batches of 100, one at a time, waits on 429 (Retry-After), 2 retries on 5xx |
| `horizonCache.ts` | localStorage cache of computed profiles keyed by `lat,lon` (4 decimals) and panel height |
| `sunPathData.ts` / `sunPath.ts` | sun paths for the 21st of each month (SPA), split by skyline; canvas chart |
| `map.ts` | Leaflet map: Esri World Imagery + labels, draggable pin, rotatable arrow overlay. Also the altitude lookup (Open-Meteo) and geocoding (Nominatim) |
| `compass.ts` | SVG compass dial (drag / arrow keys) and the tilt side view |
| `charts.ts` | Chart.js monthly bars (optimal vs yours) and the loss chart; colours from CSS tokens; re-themes on change |
| `heatmap.ts` | canvas heatmap, hover tooltip, click to set orientation |
| `debugView.ts` | grouped step list, day table |
| `helpers.ts` | pure helpers: pointer → azimuth, compass points, colour ramp, number formatting |
| `styles.css` | design tokens (light and dark), layout |

## Settings and URL state

- `AppState` holds:
  - location (lat, lon, altitude)
  - `siteIsExample`
  - model params (TL, albedo, transposition)
  - weather source
  - your orientation
  - system (kWp, PR)
  - chart unit
  - active tab
  - debug date, hour and orientation
- Load order: `DEFAULTS` ← localStorage key `sunward.v1` (sanitized) ← query string (sanitized).
- Every change calls `save()` → `persist()`. That writes localStorage and
  `history.replaceState(…?query)`.
- Query keys (never rename): `lat lon alt tilt az kwp pr tl alb tm src unit tab dd dh do hm hh hp`.
  - `hm` / `hh`: terrain shading on/off and panel height.
  - `hp`: the terrain profile itself (72 bytes, base64url, 0.5° steps). It is only present when
    shading is on, so a shared link needs no elevation download.
- A link that includes `lat`/`lon` clears `siteIsExample`.
- Invalid values are clamped or ignored (tested).

## Deployment targets

| | Standalone `dist/index.html` | claude.ai Artifact `dist/artifact.html` |
|---|---|---|
| Build | `npm run build` (vite-plugin-singlefile inlines JS, CSS and the worker) | `npm run artifact` (strips the doctype/head/body) |
| Satellite map | yes (Esri tiles) | blocked (no external images) → compass fallback |
| GPS | yes; needs HTTPS or localhost in most browsers | blocked |
| Address search / altitude | yes (Nominatim, Open-Meteo) | blocked (no fetch) |
| Terrain shading | yes (AWS Terrain Tiles, Open-Meteo backup, cached) | only with a profile already cached in that browser; otherwise an explanatory message |
| Query-string settings | yes | the query never reaches the page; the share button is hidden |
| localStorage | yes | yes (per viewer) |
| CSV download | blob link | `claude.use("downloads")`, declared as capability `{downloads: true}` |
| Fonts | Google Fonts (falls back to system fonts) | Google Fonts allowed |

The Artifact is published from `dist/artifact.html` with `capabilities: {downloads: true}`.

## Dependencies

- Runtime:
  - `@yogur/solpos` (MIT, NREL SPA)
  - `leaflet`
  - `chart.js`
- Dev:
  - `vite`, `vite-plugin-singlefile`
  - `vitest`
  - `typescript`
  - `@types/leaflet`
- Reference only: Python `pvlib` (fixtures).

## Browser tests (e2e/)

`npm run build && npm run test:e2e` runs Playwright against `dist/index.html` in desktop and phone
viewports. External network is blocked; the elevation service is faked where needed. CI runs these
before deploying (`browser` job). The fixture in `e2e/fixtures.ts` fails any test on uncaught errors,
console errors, a "Calculation failed" message or a visible error badge.

## In-app log and version stamp

- `ui/logStore.ts`: ring buffer (500 entries) fed by console capture, `error`/`unhandledrejection`
  listeners and `appLog.add()`. `ui/logView.ts` renders it in Debug → Log, with a filter, copy and clear,
  plus an error badge on the Debug tab.
- `ui/buildInfo.ts`: commit hash and date, from `define` in `vite.config.ts`, shown in the header and
  linked to the commit.

## Browser testing without network

The build sandbox blocks outside hosts, so the elevation service is faked with Playwright
(`pip install playwright && python -m playwright install chromium`):

```python
await context.route("https://api.open-meteo.com/**", handler)   # parse latitude/longitude lists,
# reply {"elevation": [...]} with synthetic terrain (e.g. a ridge 4 km to the SE) and
# "access-control-allow-origin: *"
```

Check that:
- turning terrain on makes 18 requests and shows "Skyline ready…"
- the optimum and the terrain line change
- the URL gets `hm=1&hp=…`
- a reload makes no new requests (cache)
- the URL opened in a fresh context with the route aborted still shows the profile (from `hp`)
