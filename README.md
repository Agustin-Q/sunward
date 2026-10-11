# Sunward — solar panel tilt & direction planner

**Live app:** https://agustin-q.github.io/sunward/

Finds the fixed tilt and azimuth that collect the most sunlight over a year at a site, estimates
monthly / daily / annual irradiance on the panel, and shows how much your current orientation loses.
Runs entirely in the browser.

## Features

- Location from GPS, typed coordinates, address search (OpenStreetMap Nominatim) or dragging the pin.
  Altitude is looked up automatically (Open-Meteo elevation API).
- Satellite map (Esri World Imagery) with the optimal (orange, dashed) and your (blue) direction arrows.
  Drag the blue arrow head, the compass dial, or the sliders to set your orientation.
- Optimal tilt/azimuth, monthly totals, daily averages, annual total, loss % per month and per year.
- Electricity estimate from system size (kWp) and performance ratio.
- Tilt × azimuth heatmap (% of the best orientation); tap a cell to try it.
- Weather-source dropdown: *Clear sky (offline)* or *NASA POWER* real weather (2019–2023 hourly mean,
  downloaded in the browser and cached; falls back to clear sky if unreachable).
- Debug view: every calculation step for any hour with formula, substituted numbers and result;
  the full day hour by hour; totals, optimizer, loss and energy steps; CSV export of the whole year;
  a pvlib-python snippet that reproduces the selected hour independently.
- Terrain shading: the skyline is computed from 90 m elevation data (Open-Meteo, Copernicus GLO-90)
  out to 30 km. Hills block the sun and part of the sky; a sun-path chart shows which months and
  hours are hidden; the optimum, totals and loss include it.
- Settings are saved in the browser (localStorage), so a refresh keeps everything, and mirrored into
  the address bar's query string, so the URL is a shareable link (`Copy share link` button).
  Example: `index.html?lat=59.9139&lon=10.7522&alt=23&tilt=45&az=200&tab=heatmap`.

## How it calculates

For each of 8 760 hours (hh:30 UTC, reference year 2025):

1. Sun position — NREL SPA via [`@yogur/solpos`](https://github.com/yogur/solpos), pressure from altitude, 12 °C.
2. Extraterrestrial irradiance — Spencer (1971), solar constant 1366.1 W/m².
3. Air mass — Kasten & Young (1989), pressure corrected.
4. Clear-sky GHI/DNI/DHI — Ineichen & Perez (2002) with Linke turbidity (default 3).
5. Angle of incidence — `cos θ = cos β cos θz + sin β sin θz cos(γs − γ)`.
6. Plane of array — beam + Hay-Davies (or isotropic) sky diffuse + ground reflection (albedo 0.2).
7. Sum to monthly kWh/m²; daily average = month / days; annual = Σ months.
8. Optimum — coarse 5° × 10° grid (also the heatmap), then 1° refinement.
9. Loss % = (H_opt − H_yours) / H_opt × 100. Energy kWh = H × kWp × PR.

Each step mirrors the corresponding pvlib-python function so results can be checked against it.

## Tests

```sh
npm install
npm test            # unit + integration tests (vitest)
npm run typecheck
npm run fixtures    # regenerate reference values (needs: pip install pvlib)
```

`src/core/__fixtures__/pvlib.json` holds reference values produced by `reference/generate_fixtures.py`
with pvlib 0.16.1 for Madrid, Oslo, Sydney, Quito and Denver: pure-function cases, hourly samples with
every intermediate value, monthly/annual totals for 7 orientations × 2 diffuse models, and brute-force
optima. The library's solar position is also checked against the NREL SPA report's reference case.
`shading.json` covers the terrain model (numpy reference with Monte Carlo checks), and
`integration.json` runs the full calculation for Buenos Aires, Alicante, Fresno, Alice Springs and Tokyo.

## Build & run

```sh
npm run dev         # local dev server
npm run build       # dist/index.html — one self-contained file
npm run artifact    # also dist/artifact.html for claude.ai Artifacts
```

`dist/index.html` works when opened from disk or served from any static host. GPS needs HTTPS or
localhost in most browsers (`npx vite preview` is enough). Inside a claude.ai Artifact the map imagery,
GPS and address search are blocked by the sandbox; the page detects this and falls back to the compass
and typed coordinates. All calculations work the same.

## Adding a real-weather source

Implement `WeatherSource` in `src/core/weather.ts` (`hour()` and `year()` returning GHI/DNI/DHI plus sun
position) and mark it `available: true`. Nothing else changes; the debug view traces whatever the source
records.

## Deployment

Every push to `main` runs `.github/workflows/pages.yml`:
1. `npm run check` (types, all tests, and the mandatory Buenos Aires / Alicante integration tests again)
2. `npm run build`
3. Deploy `dist/` to GitHub Pages

A failing test blocks the deploy. Pages must be set to **Source: GitHub Actions** (Settings → Pages).

## Docs

- `CLAUDE.md` — working rules and commands for Claude Code sessions
- `docs/REQUIREMENTS.md` — requested features and decisions
- `docs/CALCULATIONS.md` — every formula and its pvlib equivalent
- `docs/ARCHITECTURE.md` — modules, data flow, settings/URL state, deployment targets
- `docs/ROADMAP.md` — status, next candidates, caveats

## Layout

```
src/core/        pure calculation modules (+ __tests__, __fixtures__)
src/ui/          settings/URL state, map, compass, charts, heatmap, debug rendering, helpers (+ tests)
src/worker.ts    year build + optimizer off the main thread
reference/       pvlib fixture generator
```
