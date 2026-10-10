# CLAUDE.md — Sunward (solar panel tilt & direction planner)

Browser-only TypeScript app. It finds the fixed tilt/azimuth that maximises annual sunlight on a
solar panel, estimates monthly / daily / annual plane-of-array irradiance, compares the user's current
orientation against the optimum (loss in kWh/m² and %), converts to kWh, shows a tilt × azimuth
heatmap, and has a debug view that traces every calculation step.

Read these before changing things:

- `docs/REQUIREMENTS.md`: what the user asked for, and their decisions. **The source of truth for scope.**
- `docs/CALCULATIONS.md`: every formula, its source, and how it maps to pvlib.
- `docs/ARCHITECTURE.md`: modules, data flow, settings and URL state, deployment targets and sandbox limits.
- `docs/ROADMAP.md`: what is done, what is next, and known caveats.
- `docs/plans/`: agreed plans for upcoming features (start with `terrain-shading.md`).

## Commands

```sh
npm install
npm test              # vitest: all unit tests (core + ui helpers + settings)
npm run typecheck     # tsc, strict
npm run check         # typecheck + tests (run before finishing any change)
npm run dev           # vite dev server (full features: map, GPS on localhost, search)
npm run build         # dist/index.html: single self-contained file
npm run artifact      # build + dist/artifact.html (claude.ai Artifact variant)
npm run fixtures      # regenerate all pvlib/numpy reference values (pip install pvlib; ~2 min)
```

## Ground rules

1. **All calculations live in `src/core/`. Keep it pure:** no DOM, no fetch, no globals. UI code
   only calls into it.
2. **Every calculation must be unit-tested.** New formulas get tests against pvlib-python values
   added to the generators in `reference/` (`generate_fixtures.py`, `generate_shading_fixtures.py`,
   `generate_integration_fixtures.py`), then `npm run fixtures`. Pipeline changes must keep the
   five-site integration tests (`src/core/__tests__/integration.test.ts`) passing. Property tests alone are not
   enough when a pvlib equivalent exists. Do not hand-edit anything in `src/core/__fixtures__/`.
3. **Use libraries for the hard parts.** Solar position comes from `@yogur/solpos` (NREL SPA). Don't
   replace it with an approximation. `src/core/textbook.ts` is a learning aid shown in the debug
   view only and must never feed results.
4. **Match pvlib conventions exactly:**
   - azimuth is clockwise from north (0 N, 90 E, 180 S, 270 W)
   - tilt 0 = flat, 90 = vertical
   - irradiance uses the **apparent** (refraction-corrected) zenith
   - pressure comes from altitude, temperature is 12 °C
   - extraterrestrial irradiance uses Spencer with a solar constant of 1366.1
   - the Hay-Davies Rb guard uses `cos z ≥ 0.01745`
5. **Tracing:** each core function takes an optional `Tracer` and records the values it actually
   computed (`t?.add({...})`). The debug view must show real computed values, never a parallel
   re-implementation. When you add a step:
   - add a trace entry with label, symbol, formula and substituted numbers
   - add a test asserting `traced(t, key)` equals the returned value
6. **Weather sources are pluggable** (`WeatherSource` in `src/core/weather.ts`). Only "Clear sky
   (offline)" is implemented. PVGIS and NASA POWER are listed as disabled placeholders. A new
   source must not change any other module.
7. **Settings:** every user setting lives in `AppState` (`src/ui/appState.ts`):
   - It persists to localStorage (`sunward.v1`) and is mirrored into the query string on every
     change, so a refresh keeps everything and the address bar is always a shareable link.
   - Load order: defaults ← localStorage ← query string (the link wins).
   - New settings need a `sanitize()` rule, a `QUERY_KEYS` entry, `toQuery`/`fromQuery` support,
     and a round-trip test.
   - Never rename existing query keys, because that breaks shared links.
8. **Two deployment targets from one build:**
   - **Standalone `dist/index.html`:** satellite map, GPS, address search and altitude lookup.
   - **claude.ai Artifact `dist/artifact.html`:** sandboxed. External images, fetch, geolocation
     and the query string are blocked. Downloads go through `claude.use("downloads")`.

   The UI detects what is blocked and degrades: compass instead of map, typed coordinates, the
   share button hidden. Keep both working. Don't add CDN dependencies; bundle everything.
9. **UI copy:** plain and specific, from the user's side ("Set to optimal", not "Apply optimum").
   Colours come from the CSS tokens in `src/ui/styles.css`, defined for both light and dark themes.

## Where things are

```
src/core/            pure model: types, trace, math, atmosphere, extraterrestrial, solarPosition,
                     clearsky, planeOfArray, horizon, shading, terrain, weather (sources),
                     simulate, optimize, compare,
                     energy, textbook, debug (hour trace, CSV, pvlib snippet), index
src/core/__tests__/  unit tests (fixtures from pvlib, helpers.ts has close() + cached years)
src/core/__fixtures__/pvlib.json   generated reference values. Do not edit by hand.
src/ui/              appState (settings/URL/storage), elevation (Open-Meteo sampler), horizonCache,
                     sunPath (+Data), map (Leaflet + Esri), compass, charts
                     (Chart.js), heatmap (canvas), debugView, helpers, styles.css
src/main.ts          wiring: state, worker calls, rendering, events
src/worker.ts        builds the weather year + runs the optimizer off the main thread
reference/           generate_fixtures.py (pvlib)
scripts/             to-artifact.mjs (strips the HTML skeleton for the Artifact host)
docs/                requirements, calculations, architecture, roadmap
```

## Verification habit

After a change:
1. Run `npm run check`.
2. For UI work, run `npm run build` and open `dist/index.html`.
3. Check both light and dark themes, at phone width (about 400 px) and desktop width.

Madrid with defaults (TL 3, albedo 0.2, Hay-Davies, terrain off) must give an optimum of
**38° tilt, ~178° azimuth, ~2,500 kWh/m²/yr**. That's a quick sanity check.

Terrain shading is off unless enabled. With it off, every result must stay identical to pvlib.
Elevation data comes from Open-Meteo, which the build sandbox can't reach. Fake it in browser tests
by routing `https://api.open-meteo.com/**` (see the Playwright approach in docs/ARCHITECTURE.md).
