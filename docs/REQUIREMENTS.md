# Requirements and decisions

This records what the user asked for and what they decided, in order. When scope is unclear,
this file wins over guesses.

## Original request

> Create a web to calculate the tilt and direction for optimal placement of solar panels. Get
> location automatically or manually, have a satellite map to show the direction. Estimate effective
> irradiance the panel will receive monthly, daily and annually. Select the current angle and
> direction and calculate the data and the deviation from optimal, to know how much I lose. Use
> libraries for calculations. All calculations must be unit tested. First refine the features and
> requirements, then investigate and make a plan.

## Refined features (all implemented in v1)

1. **Location:** browser geolocation; manual lat/lon/altitude; address search; drag the map pin.
   Altitude is auto-filled from an elevation API when available.
2. **Satellite map:** site pin, an arrow for the optimal direction (orange, dashed) and one for the
   user's direction (blue, draggable). A compass dial gives the same control when the map can't
   load.
3. **Optimal orientation:** the fixed tilt and azimuth that maximise annual plane-of-array (POA)
   irradiation.
4. **Irradiance on the panel (kWh/m²):** monthly totals, average per day for each month, annual
   total, for both the user's orientation and the optimum. Shown as a chart and a table.
5. **Loss analysis:** tilt and azimuth deviation in degrees; loss in kWh/m² and % per month and per
   year. Negative monthly loss is expected (see "Answers given" below).
6. **Electricity:** kWh = POA kWh/m² × kWp × performance ratio (default 5 kWp, PR 0.80).
7. **Heatmap:** tilt × azimuth grid showing annual POA as % of the optimum. Tap a cell to try it.
8. **Weather-source dropdown:** v1 has only **Clear sky (offline)**. The design must allow PVGIS,
   NASA POWER and others later, through the same dropdown, with no changes elsewhere.
9. **Debug view:** every calculation step shown with its value, formula and substituted numbers, so
   a wrong calculation is easy to find. Covers one chosen hour (inputs, time, sun, atmosphere, top
   of atmosphere, clear sky, panel geometry, POA, textbook check), the whole day hour by hour,
   monthly and annual totals, optimizer trace, loss and energy. Also a CSV export of the full year
   and a pvlib snippet that reproduces the hour independently.
10. **Settings persistence:** all settings are kept in localStorage, so a page refresh changes
    nothing. All settings are also stored in the query string, so the URL can be shared. Includes:
    location, panel orientation, system size, model settings, chart unit, active tab and debug hour.

## User decisions

| Question | Decision |
|---|---|
| Where calculations run | **Browser only, TypeScript** (no backend) |
| Weather data | **Start with offline clear sky**, switchable later via a dropdown |
| Extras for v1 | **kWh from system size** and the **tilt × azimuth heatmap** |
| Debug view | Added at the user's request before the build started |
| Settings | Persist in localStorage, and shareable via the query string (added after v1) |

Not chosen for v1: horizon shading (PVGIS terrain), seasonal optima, tracking mounts.

## Answers given to the user (keep consistent)

- **Beam-only vs including diffuse (Madrid, south 35°, clear sky):**
  - beam is 86% of the total, sky diffuse 12%, ground 1–2%
  - beam-only understates totals by about 14% under clear sky, and by about 25–35% with real weather
  - the optimal tilt barely moves (38° vs 35°)
  - the loss % for bad orientations shifts by a few points
  - conclusion: keep the diffuse and ground terms
- **Why the optimal is lower than "yours" in some months:**
  - the optimum is the best *single fixed angle for the whole year*
  - a flatter panel wins in summer (high sun, ideal tilt ~17° in June in Madrid)
  - it loses more in winter (ideal tilt ~64° in December), so the yearly total is lower
  - the user was offered a "best tilt per month" line; it is not yet requested
