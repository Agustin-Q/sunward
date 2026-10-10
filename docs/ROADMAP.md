# Roadmap and status

## Done (v1)

- [x] Calculation core: SPA, Spencer, Kasten-Young, Ineichen, AOI, Hay-Davies and isotropic, ground
      reflection, annual simulation, optimizer, loss, energy
- [x] Unit tests against pvlib for 5 sites, plus the NREL SPA reference case (102 tests in total)
- [x] Location from GPS, manual entry, address search or pin drag; altitude auto-lookup
- [x] Satellite map with optimal and yours arrows; compass dial fallback; tilt side view
- [x] Monthly / daily / annual chart and table; loss chart; kWh
- [x] Tilt × azimuth heatmap (tap a cell to set)
- [x] Weather-source dropdown (clear sky now; PVGIS and NASA POWER listed but disabled)
- [x] Debug view: hour trace, day table, totals/optimizer/loss/energy traces, CSV, pvlib snippet
- [x] Settings persisted to localStorage and mirrored to the query string (share link button)
- [x] Standalone single-file build plus a claude.ai Artifact build

## Next candidates (not yet requested unless noted)

1. **Best tilt per month line** (offered to the user, not confirmed). Per month, the optimal tilt
   and its kWh/m² next to the fixed optimum. Useful for adjustable mounts (two-season adjustment
   typically gains a few %).
2. **Real-weather sources:**
   - **NASA POWER** first: global, browser CORS OK. Hourly data needs a typical year built from
     several years; the climatology endpoint gives monthly means.
   - **PVGIS TMY**: best for Europe, but no browser CORS, so it needs a small proxy (for example a
     Cloudflare Worker) or a pre-fetched file.
   - Implement through `WeatherSource`; nothing else should change.
3. **Terrain shading**: planned and decided, see `docs/plans/terrain-shading.md`. Terrain only, full
   diffuse model, sun-path chart.
4. **Linke turbidity by location**: a small monthly TL table (coarse grid) bundled, instead of the
   single default of 3.
5. **Incidence-angle losses and temperature model** (pvlib `iam.physical`, the Faiman model) for
   better kWh estimates.
6. **Seasonal optima** (summer / winter tilt).
7. **Map extras:** a draggable roof outline to read roof azimuth from the imagery.

## Known caveats

- Clear-sky absolute totals are optimistic. The UI says so in the caveat line under the stats.
- Months are grouped in UTC. For sites far from UTC, an hour or two at month boundaries is
  attributed to the neighbouring month, which is negligible for monthly totals.
- Inside the Artifact viewer the map, GPS, search and links are blocked by the sandbox (by design;
  see ARCHITECTURE.md).
- The optimizer refines only around the coarse best. This is fine for the smooth annual surface;
  it is verified against pvlib brute force within 2° tilt and 4° azimuth.
