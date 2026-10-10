# Plan: terrain (horizon) shading

Status: **planned, not started.**

## Decisions (user, 2026-10-10)

| Question | Decision |
|---|---|
| Horizon source | **Terrain only:** computed automatically from elevation data. No manual editor and no import. |
| Diffuse treatment | **Full model:** hide the beam and circumsolar light, and reduce the isotropic sky by the sky view factor with horizon. |
| Sun-path chart | **Yes:** monthly sun paths with the horizon silhouette (display only, not editable). |

## Goal

Account for hills and mountains that hide the sun or part of the sky. Nearby trees and buildings
are out of scope for now (terrain only). The model must then:
- block the beam when the sun is behind the horizon
- reduce diffuse sky light by how much of the sky is hidden
- feed both into the optimum, the totals, the loss figures and the debug view

Shading changes the *optimum* too: a mountain to the east pushes the best azimuth west.

## Physics

Inputs:
- the horizon profile `e_h(φ)`: horizon elevation angle (degrees) by azimuth φ (clockwise from
  north), every 5° (72 values)
- the hourly sun position and the panel orientation (β, γ)

1. **Horizon at the sun's azimuth:** `e_h(γs)` by linear interpolation, wrapping 355° → 0°.
2. **Sun visible:** `v = 1` if the apparent sun elevation `α = 90 − θz′ > e_h(γs)`, otherwise `0`.
3. **Beam:** `Eb = v · max(DNI · cos θ, 0)`.
4. **Circumsolar diffuse (Hay-Davies):** `Ed,cs = v · DHI · Ai · Rb`. It comes from around the sun,
   so it is hidden with it.
5. **Isotropic sky diffuse:** the sky view factor `Fsky = (1+cos β)/2` is replaced by the sky view
   factor with horizon (Dozier & Frew 1990):

   ```
   e(φ)  = max(e_h(φ), e_plane(φ)),   e_plane(φ) = atan(−tan β · cos(φ − γ))   (the panel's own plane)
   H(φ)  = 90° − e(φ)                 (horizon zenith angle)
   Fsky,h = (1/2π) ∫₀^2π [ cos β · sin²H + sin β · cos(φ − γ) · (H − sin H cos H) ] dφ
   ```

   Then `Ed,iso = DHI · (1 − Ai) · Fsky,h` (isotropic model: `DHI · Fsky,h`).
   - Verified: with a flat horizon this gives exactly `(1+cos β)/2` for β = 0, 20, 35, 60 and 90°.
   - With a uniform 10° horizon at β = 35° south it gives 0.8335; Monte Carlo integration over the
     sky dome gives 0.8334.
   - Computed once per orientation (72-step sum). This is cheap enough for the optimizer.
6. **Ground-reflected:** the ground under the panel also sees less sun and sky:
   - `GHI_h = v · DNI · cos θz′ + DHI · Fsky,h(β=0)`
   - `Eg = GHI_h · ρ · (1 − cos β)/2`

   Light reflected *by* the mountains is ignored; this is the standard assumption.
7. **Shading loss:** run the year with and without the horizon.
   `Shading loss % = (H_open − H_shaded) / H_open · 100`, per month and per year, for the user's
   orientation and the optimum.

## Getting the horizon profile

| Option | How | Works in Artifact? | Notes |
|---|---|---|---|
| **A. Compute from elevation data** ✅ chosen | Sample the Open-Meteo elevation API (Copernicus GLO-90 DEM, 90 m, up to 100 points per request) along 72 rays at about 25 log-spaced distances from 150 m to 30 km. This is about 1,800 points in 18 requests. | ❌ (fetch blocked) | Open-Meteo is already used for the altitude lookup. The API's CORS behaviour needs checking, and its fair-use limits need respecting (cache per site). |
| B. AWS Terrain Tiles (Terrarium PNG) | Decode tiles via canvas and ray-cast locally | ❌ | Fallback if A is blocked, too slow or rate-limited. |
| C. PVGIS `printhorizon` | Ready-made, uses the same algorithm as PVGIS | ❌ | PVGIS forbids browser (AJAX) calls, so it needs a proxy. Useful later with the PVGIS weather source. |
| ~~D. Manual editor / E. Import~~ | | | Not chosen. Could be added later for trees and buildings. |

**Ray-casting** for each azimuth φ and distance d:
- `drop(d) = d² · (1 − k) / (2R)`, with R = 6,371 km and refraction k = 0.13
- `e(φ) = max_d atan2(z(d) − drop(d) − (z₀ + h_panel), d)`
- where z₀ is the DEM elevation at the site and h_panel is the panel height above ground (user
  input; default 0 m for ground mounts, about 6 m for a typical roof)
- distances under about 150 m are skipped, because the 90 m DEM is too coarse there (nearby
  obstacles are out of scope)
- the trace keeps the distance and elevation of the blocking point for each azimuth

## Code changes

**Core (pure, tested):**
- `src/core/horizon.ts` (new):
  - `HorizonProfile { stepDeg, elevations[] }`
  - `horizonAt(profile, az)`
  - `sunVisible(...)`
  - `skyViewFactor(profile, tilt, azimuth)`
  - `resample()`
  - encode and decode for the URL
- `src/core/terrain.ts` (new): `computeHorizon(site, panelHeight, sampler, opts)`
  - `sampler(points) → Promise<number[]>` is injected, so core stays fetch-free and tests use
    synthetic terrain
  - pure ray geometry: `rayPoints()` (great-circle destination), `curvatureDrop()`
- `planeOfArray.ts`: optional `shade?: { sunVisible: boolean; fSky: number; fSkyHorizontal: number }`.
  Leaving it out gives exactly today's numbers, so the existing pvlib tests stay valid.
- `weather.ts` / `simulate.ts`:
  - a `ShadingContext` built once per site and profile, with a per-hour `visible: Uint8Array` from
    the sun position
  - `simulateYear(w, o, params, shading?)` computes `fSky` once per orientation
- `optimize.ts`: passes shading through. The heatmap becomes shaded % of the shaded best.
- Tracing:
  - new hour steps: "Horizon at sun azimuth", "Sun visible", "Sky view with horizon"
  - beam, circumsolar and isotropic formulas show the factors
  - a horizon-profile section lists each azimuth's blocking point

**UI:**
- **Terrain and obstacles** panel:
  - toggle **Terrain shading** `Off | On`
  - panel height above ground
  - progress while the profile is fetched (18 requests); it recalculates automatically when the
    location or height changes, and is cached
  - in the Artifact, where fetch is blocked: the toggle is disabled with a one-line reason, unless
    a cached profile exists for this site
- **Sun-path chart** (new): azimuth on x, elevation on y
  - sun paths for the 21st of each month, labelled by month
  - the horizon as a filled silhouette
  - the hour-of-day grid
  - display only; it shows at a glance which months and hours are blocked
- Map: optional thin rays coloured by horizon height (standalone only).
- Results:
  - new stat "Lost to terrain: x%"
  - monthly table column "Shading loss"
  - the monthly chart can show unshaded bars as a faint outline
- Debug: the new steps, plus the horizon table (azimuth, elevation, blocking distance and altitude).

**Settings and URL:**
- `AppState.horizon = { enabled, panelHeight }`; the profile itself is data, not a setting
- the computed terrain profile is cached in localStorage keyed by `lat, lon` (rounded to 4
  decimals) and panel height, so a refresh needs no new requests
- query keys (new, never rename):
  - `hm` (`0` off / `1` on)
  - `hh` (panel height)
  - `hp`: profile as base64url of 72 bytes at 0.5° steps (0–127.5°), about 96 characters
- a shared link carries the profile, so the receiver needs no network for it. That's the only way
  shading works in a sandbox that blocks fetch.

**Docs:** CALCULATIONS.md §10 Horizon, ARCHITECTURE (ShadingContext, sampler), REQUIREMENTS
(decision), ROADMAP.

## Tests

1. `horizonAt`: interpolation, wrap-around, resampling from 8, 12 or 36 values to 72.
2. `skyViewFactor`:
   - a flat horizon equals `(1+cos β)/2` for many β and γ
   - a uniform-horizon case matches a pvlib-free numerical integration of the sky dome generated in
     `reference/generate_fixtures.py` (quadrature or Monte Carlo); several tilts, orientations and
     profiles
   - property checks: monotonic in horizon height, in [0, 1], horizontal vs 90° wall
3. Sun visibility and the zeroing of beam and circumsolar.
4. With no horizon, `planeOfArray` and `simulateYear` match today's outputs exactly (no regression).
5. Year simulation with shading against an independent Python implementation of the same model on
   pvlib's clear-sky series.

   pvlib 0.16 has no horizon-shading function. It only has `iotools.get_pvgis_horizon` and
   row-shading helpers. So the reference applies the mask and Dozier sky view factor in plain
   numpy to pvlib's clear-sky and Hay-Davies components, for Madrid with synthetic profiles
   (east ridge 15°, south ridge 20°, valley 10° all round).
6. `computeHorizon` with synthetic terrain:
   - a cone hill of known height and distance gives the exact `atan` angle
   - curvature drop at 30 km is about 61 m
   - a flat plain gives 0°
   - a wall behind the site gives the expected angle
   - the trace reports the blocking point
7. A real-data fixture: a PVGIS horizon for one mountain site, fetched once outside the browser with
   `pvlib.iotools.get_pvgis_horizon`. Compare it with our ray-cast profile from a recorded
   Open-Meteo response. Tolerance: a few degrees, since the DEMs and sampling differ.
8. Settings: round-trip of `hm/hh/hp`, a bad profile string is ignored, and the cache key is
   correct.

## Milestones

1. Core horizon math (`horizon.ts`) and shading in `planeOfArray`/`simulate`/`optimize`, with tests 1–5.
2. Terrain computation: `terrain.ts`, a spike to check Open-Meteo CORS and limits, the sampler,
   caching, with tests 6–7. Fall back to Terrain Tiles if needed.
3. UI: toggle, panel height, progress, sun-path chart, results column and stat, debug steps and
   horizon table, settings/URL (`hm/hh/hp`) with test 8.
4. Docs and publish.

## Risks

- **Open-Meteo CORS or rate limits:** checked first in milestone 2. If either fails, fall back to option B
  (Terrain Tiles) or a proxy.
- **90 m DEM misses nearby obstacles** (trees, buildings). With terrain only, the results don't
  include them; the UI says so.
- **Published Artifact:** fetch is blocked, so it can't compute a horizon. It only works with a
  profile cached in that browser; otherwise the toggle is disabled with a reason.
- **Clear sky overstates beam light,** so terrain losses come out somewhat high. Real weather has
  more diffuse light, and diffuse light is less affected by the horizon. This will be stated in the
  caveat line.
