# Architecture

## Data flow

```
settings (AppState) ──► worker.ts ──► WeatherSource.year(site, params)    8,760 hours of
   │                       │            └─ clearSkyHour(): SPA → air mass  sun position +
   │                       │               → I₀ → Ineichen                 GHI/DNI/DHI/I₀
   │                       └──► optimize(weather) ─► best orientation + heatmap + trace
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
| `planeOfArray.ts` | angle of incidence, beam, Hay-Davies / isotropic, ground, total |
| `weather.ts` | `WeatherSource` interface, `clearSkySource`, registry `WEATHER_SOURCES` (PVGIS / NASA disabled) |
| `simulate.ts` | `simulateYear()` → `YearResult` (monthly, dailyAvg, annual, components) |
| `optimize.ts` | grid + refinement, heatmap |
| `compare.ts` | deviation, monthly/annual loss |
| `energy.ts` | kWh from kWp and PR |
| `textbook.ts` | approximate sun position for learning (debug only) |
| `debug.ts` | `traceHour()`, `hourRows()`, `rowsToCsv()`, `pvlibSnippet()` |

### Tracing contract

Each step function accepts `t?: Tracer` and calls `t?.add({ key, label, symbol, formula,
substituted, value, unit })`. `t.group(name)` sets the section heading. Keys are stable (for
example `clearsky.ghi`, `poa.global`). Tests assert that traced values equal the returned values.

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
- Query keys (never rename): `lat lon alt tilt az kwp pr tl alb tm src unit tab dd dh do`.
- A link that includes `lat`/`lon` clears `siteIsExample`.
- Invalid values are clamped or ignored (tested).

## Deployment targets

| | Standalone `dist/index.html` | claude.ai Artifact `dist/artifact.html` |
|---|---|---|
| Build | `npm run build` (vite-plugin-singlefile inlines JS, CSS and the worker) | `npm run artifact` (strips the doctype/head/body) |
| Satellite map | yes (Esri tiles) | blocked (no external images) → compass fallback |
| GPS | yes; needs HTTPS or localhost in most browsers | blocked |
| Address search / altitude | yes (Nominatim, Open-Meteo) | blocked (no fetch) |
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
