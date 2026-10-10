# Calculations

**Conventions:**
- angles in degrees
- azimuth clockwise from north (0 N, 90 E, 180 S, 270 W)
- tilt β: 0 = flat, 90 = vertical
- φ = latitude, λ = longitude, h = altitude (m)
- irradiance in W/m²; energy in Wh/m² or kWh/m²

Every function below mirrors a pvlib-python function and is unit-tested against values that
pvlib 0.16.1 produced (`reference/generate_fixtures.py`).

## 0. Time base

A reference year of 2025 (not a leap year): 8,760 hourly steps at **hh:30 UTC**. Each hour's power
in W/m² × 1 h gives Wh/m². Months are grouped by UTC month.
→ `src/core/weather.ts` (`hourEpoch`, `buildYear`)

## 1. Solar position (library)

NREL SPA (Reda & Andreas 2008) via `@yogur/solpos`, about ±0.0003°. The inputs are the instant, φ,
λ and h, plus refraction settings: pressure from altitude and 12 °C (the pvlib defaults). The
outputs are:
- geometric zenith θz
- apparent zenith θz′ (refraction-corrected)
- azimuth γs

**θz′ is used for all irradiance**, as in pvlib's ModelChain.
→ `src/core/solarPosition.ts` ≙ `pvlib.location.Location.get_solarposition`

Library check: the NREL report's reference case (2003-10-17 12:30:30 −7 h, Golden CO) gives
zenith 50.11162° and azimuth 194.34024°. This is tested.

### Textbook check (debug view only, never used for results)
- `δ = 23.45° · sin(360°·(284+n)/365)` (Cooper)
- `EoT = 229.18·(0.000075 + 0.001868 cos B − 0.032077 sin B − 0.014615 cos 2B − 0.040849 sin 2B)` minutes
- `t_s = UTC + λ/15 + EoT/60`
- `ω = 15°·(t_s − 12)`
- `cos θz = sin φ sin δ + cos φ cos δ cos ω`

Within about 1° of SPA. → `src/core/textbook.ts`

## 2. Atmosphere

- Pressure: `p = 100 · ((44331.514 − h) / 11880.516)^(1/0.1902632)` Pa ≙ `atmosphere.alt2pres`
- Relative air mass (Kasten & Young 1989, uses θz′): `AM = 1 / (cos θz′ + 0.50572·(96.07995 − θz′)^−1.6364)`. NaN when θz′ > 90°.
- Absolute air mass: `AMa = AM · p / 101325`

→ `src/core/atmosphere.ts`

## 3. Extraterrestrial irradiance (Spencer 1971)

- `B = 2π(n−1)/365`
- `I₀ = 1366.1 · (1.00011 + 0.034221 cos B + 0.00128 sin B + 0.000719 cos 2B + 0.000077 sin 2B)`

This is within ±3.6% of the solar constant over the year. ≙ `irradiance.get_extra_radiation`
→ `src/core/extraterrestrial.ts`

## 4. Clear sky: Ineichen & Perez (2002)

Inputs are θz′, AMa, Linke turbidity TL (default 3), h and I₀. The Perez enhancement is off.

| Step | Formula |
|---|---|
| Altitude factors | `fh1 = e^(−h/8000)`, `fh2 = e^(−h/1250)` |
| Coefficients | `cg1 = 5.09e−5·h + 0.868`, `cg2 = 3.92e−5·h + 0.0387` |
| GHI | `GHI = cg1 · I₀ · cos θz′ · e^(−cg2·AMa·(fh1 + fh2·(TL−1)))` |
| Beam coefficient | `b = 0.664 + 0.163/fh1` |
| DNI before cap | `DNI₁ = I₀ · b · e^(−0.09·AMa·(TL−1))` |
| DNI cap | `DNI₂ = GHI · (1 − (0.1 − 0.2·e^(−TL))/(0.1 + 0.882/fh1)) / cos θz′` |
| DNI | `DNI = min(DNI₁, DNI₂)` |
| DHI | `DHI = GHI − DNI · cos θz′` |

All values are 0 when the sun is below the horizon. ≙ `clearsky.ineichen`
→ `src/core/clearsky.ts`

TL guide: about 2 for very clean air, 3 typical, 5+ hazy or polluted. pvlib normally looks TL up
from a global monthly dataset (a large data file), which can't ship offline. That's why it's a
user setting.

## 5. Angle of incidence

`cos θ = cos β · cos θz′ + sin β · sin θz′ · cos(γs − γ)`, clipped to [−1, 1]
≙ `irradiance.aoi_projection` → `src/core/planeOfArray.ts`

## 6. Plane-of-array (POA) irradiance

| Component | Formula |
|---|---|
| Beam | `Eb = max(DNI · cos θ, 0)` |
| Sky view factor | `Fsky = (1 + cos β)/2` |
| **Hay-Davies** (default) | `Ai = DNI / I₀`; `Rb = max(cos θ, 0) / max(cos θz′, 0.01745)` |
| circumsolar | `Ed,cs = max(DHI · Ai · Rb, 0)` |
| isotropic part | `Ed,iso = max(DHI · (1 − Ai) · Fsky, 0)` |
| **Isotropic** (option) | `Ed = DHI · Fsky` (no circumsolar term) |
| Ground | `Eg = GHI · ρ · (1 − cos β)/2`, albedo ρ default 0.2 |
| Total | `POA = Eb + Ed,cs + Ed,iso + Eg` |

≙ `irradiance.get_total_irradiance(model="haydavies" | "isotropic")`

Worked example (tested), Madrid at the equinox, solar noon:
- inputs: θz = 40.4°, β = 35°, γ = 180°, DNI = 900, DHI = 100, I₀ = 1369.6
- Eb = 896
- Ed = 117
- Eg = 14.2
- POA ≈ 1,027 W/m²

## 7. Aggregation

- Monthly `H_m = Σ POA · 1 h / 1000` (kWh/m²)
- Daily average `h_m = H_m / days(m)`
- Annual `H = Σ H_m`

→ `src/core/simulate.ts`

## 8. Optimizer

1. Coarse grid: tilt 0–90° in 5° steps × azimuth 0–350° in 10° steps (684 orientations). This is
   also the heatmap.
2. Fine grid at 1° steps within ±5° tilt and ±10° azimuth of the coarse best.
3. A flat optimum (tilt 0) is reported as equator-facing, because its azimuth is meaningless.

This takes about 900 evaluations and about 0.9 s in Node; it runs in a Web Worker.
→ `src/core/optimize.ts`

Reference optima (pvlib brute force, TL 3, albedo 0.2, Hay-Davies):

| Site | Tilt | Azimuth | kWh/m²/yr |
|---|---|---|---|
| Madrid | 38° | 178° | 2,501 |
| Oslo | 49° | 180° | 1,939 |
| Sydney | 32° | 0° | 2,521 |
| Quito | 0° | (flat) | 3,198 |
| Denver | 37° | 180° | 2,700 |

## 9. Loss and energy

- `Δβ = β_you − β_opt`; `Δγ = wrap±180(γ_you − γ_opt)`
- `Loss % = (H_opt − H_you) / H_opt · 100`, per month and per year. **A monthly loss can be
  negative**, because the optimum is for the whole year (see REQUIREMENTS.md).
- `E [kWh] = H [kWh/m²] × kWp × PR`. STC (standard test conditions) is 1 kW/m², and PR (performance
  ratio) defaults to 0.80.

→ `src/core/compare.ts`, `src/core/energy.ts`

## Known modelling limits

- **Clear sky ignores clouds**, so absolute totals run high (often 20–35% in sunny climates). The
  optimal angles and the loss % are much more reliable.
- There is no shading from horizon, buildings or trees, no incidence-angle (reflection) losses and
  no temperature model. PR lumps those together.
- The model assumes a fixed mount; there is no tracking.

## Small differences from the first explanation given to the user

These are deliberate, to match pvlib:
- I₀ uses Spencer instead of `1361·(1+0.033 cos(360n/365))`.
- The Rb guard is at cos 89° (0.01745), not 85°.
- Irradiance uses the apparent zenith.
