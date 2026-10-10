"""Reference values for terrain shading, computed independently in numpy on top of
pvlib's clear-sky inputs. pvlib 0.16 has no horizon-shading function, so the model
(docs/plans/terrain-shading.md, docs/CALCULATIONS.md §10) is implemented here
separately from the TypeScript code:
  - sun visible  v = apparent elevation > horizon(sun azimuth)   (linear interp, wrap)
  - beam, circumsolar x v;  isotropic sky x Dozier sky view factor (fine quadrature)
  - ground: (v*DNI*cosZ + DHI*SVF_h(0)) * albedo * (1-cos tilt)/2
Sky view factors are also checked by Monte Carlo integration of the sky dome.

Run:  python reference/generate_shading_fixtures.py   -> src/core/__fixtures__/shading.json
"""
import json, numpy as np, pandas as pd, pvlib
from pvlib import irradiance

TL, ALBEDO = 3.0, 0.2
TIMES = pd.date_range("2025-01-01 00:30", "2025-12-31 23:30", freq="h", tz="UTC")
STEP = 5
AZ = np.arange(0, 360, STEP)

def bump(center, peak, width):
    d = (AZ - center + 180) % 360 - 180
    return peak * np.exp(-0.5 * (d / width) ** 2)

PROFILES = {
    "flat": np.zeros(72),
    "valley10": np.full(72, 10.0),
    "eastRidge": bump(90, 15, 25),
    "southRidge": bump(180, 20, 30),
    "eastWall": bump(100, 35, 40),
    "alpine": np.maximum.reduce([bump(100, 25, 30), bump(200, 12, 20), bump(280, 30, 25), np.full(72, 4.0)]),
}

def horizon_at(prof, az):
    x = np.mod(az, 360) / STEP
    i = np.floor(x).astype(int) % 72
    fr = x - np.floor(x)
    return prof[i] * (1 - fr) + prof[(i + 1) % 72] * fr

def svf(prof, tilt, az, n=18000):
    phi = (np.arange(n) + 0.5) * 360 / n
    S, A = np.radians(tilt), np.radians(az)
    c = np.cos(np.radians(phi) - A)
    if tilt >= 90:
        e_plane = np.where(c > 0, -np.pi / 2, np.where(c < 0, np.pi / 2, 0))
    else:
        e_plane = np.arctan(-np.tan(S) * c)
    e = np.maximum(np.radians(horizon_at(prof, phi)), e_plane)
    H = np.pi / 2 - e
    return float(np.mean(np.cos(S) * np.sin(H) ** 2 + np.sin(S) * c * (H - np.sin(H) * np.cos(H))))

def svf_mc(prof, tilt, az, n=3_000_000, seed=7):
    rng = np.random.default_rng(seed)
    el = np.arcsin(rng.random(n)); a = rng.random(n) * 360   # uniform over the hemisphere's solid angle
    S, A = np.radians(tilt), np.radians(az)
    w = np.sin(el) * np.cos(S) + np.cos(el) * np.sin(S) * np.cos(np.radians(a) - A)
    w = np.clip(w, 0, None) * (np.degrees(el) > horizon_at(prof, a))
    return float(w.mean() * 2)

out = {"meta": {"pvlib": pvlib.__version__, "linkeTurbidity": TL, "albedo": ALBEDO, "stepDeg": STEP},
       "profiles": {k: v.tolist() for k, v in PROFILES.items()}, "skyView": [], "yearly": [], "optimum": {}}

for name, prof in PROFILES.items():
    for tilt, az in [(0, 0), (20, 180), (35, 180), (35, 90), (60, 225), (90, 180), (45, 0)]:
        row = {"profile": name, "tilt": tilt, "azimuth": az, "value": svf(prof, tilt, az)}
        if name in ("valley10", "alpine") and tilt in (0, 35, 90):
            row["monteCarlo"] = svf_mc(prof, tilt, az)
        out["skyView"].append(row)

lat, lon, alt = 40.4168, -3.7038, 667
loc = pvlib.location.Location(lat, lon, "UTC", alt)
sp = loc.get_solarposition(TIMES)
dni_extra = irradiance.get_extra_radiation(TIMES).values
cs = loc.get_clearsky(TIMES, model="ineichen", linke_turbidity=TL, dni_extra=irradiance.get_extra_radiation(TIMES))
ghi, dni, dhi = cs.ghi.values, cs.dni.values, cs.dhi.values
zen, saz = sp.apparent_zenith.values, sp.azimuth.values
cosz = np.maximum(np.cos(np.radians(zen)), 0)
month = TIMES.month.values - 1
day = ghi > 0

def year(prof, tilt, az, model):
    v = (90 - zen > horizon_at(prof, saz)).astype(float)
    proj = irradiance.aoi_projection(tilt, az, zen, saz)
    beam = v * np.maximum(dni * proj, 0)
    sv, svh = svf(prof, tilt, az, 3600), svf(prof, 0, 0, 3600)
    if model == "haydavies":
        ai = dni / dni_extra
        rb = np.maximum(proj, 0) / np.maximum(np.cos(np.radians(zen)), 0.01745)
        iso = np.maximum(dhi * (1 - ai) * sv, 0)
        circ = v * np.maximum(dhi * ai * rb, 0)
    else:
        iso = np.maximum(dhi * sv, 0); circ = 0 * iso
    ghi_h = v * dni * cosz + dhi * svh
    ground = ghi_h * ALBEDO * (1 - np.cos(np.radians(tilt))) / 2
    poa = np.where(day, beam + iso + circ + ground, 0)
    monthly = np.bincount(month, weights=poa, minlength=12) / 1000
    return monthly, int(np.sum(day & (v == 0)))

for name in PROFILES:
    for tilt, az in [(35, 180), (35, 90), (60, 225), (20, 270), (0, 180)]:
        for model in ("haydavies", "isotropic"):
            m, blocked = year(PROFILES[name], tilt, az, model)
            out["yearly"].append({"profile": name, "tilt": tilt, "azimuth": az, "model": model,
                                  "monthly": m.tolist(), "annual": float(m.sum()), "blockedHours": blocked})

for name in ("eastRidge", "eastWall", "alpine"):
    best = (None, -1)
    for tilt in range(0, 91, 2):
        for az in range(120, 241, 3):
            a = year(PROFILES[name], tilt, az, "haydavies")[0].sum()
            if a > best[1]: best = ((tilt, az), a)
    out["optimum"][name] = {"tilt": best[0][0], "azimuth": best[0][1], "annual": float(best[1])}
    print(name, best)

json.dump(out, open("src/core/__fixtures__/shading.json", "w"), indent=1)
print("written")
