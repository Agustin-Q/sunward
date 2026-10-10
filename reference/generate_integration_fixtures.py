"""End-to-end reference for integration tests: the full calculation the app runs,
done independently with pvlib (+ numpy for terrain shading, which pvlib lacks).

Per site: clear-sky year (Ineichen, TL 3) -> optimal orientation (brute force) ->
monthly / daily / annual POA for the optimum and a "current" orientation ->
loss % -> kWh (5 kWp, PR 0.8) -> the same with a synthetic terrain horizon.

Run:  python reference/generate_integration_fixtures.py  -> src/core/__fixtures__/integration.json
"""
import json, numpy as np, pandas as pd, pvlib
from pvlib import irradiance

TL, ALBEDO, KWP, PR = 3.0, 0.2, 5.0, 0.8
TIMES = pd.date_range("2025-01-01 00:30", "2025-12-31 23:30", freq="h", tz="UTC")
DAYS = np.array([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
AZ = np.arange(0, 360, 5)

SITES = {
    "buenosAires": {"name": "Buenos Aires, Argentina", "lat": -34.6037, "lon": -58.3816, "alt": 25, "current": (20, 330)},
    "alicante": {"name": "Alicante, Spain", "lat": 38.3452, "lon": -0.4810, "alt": 10, "current": (15, 200)},
    "fresno": {"name": "Fresno, California, USA", "lat": 36.7378, "lon": -119.7871, "alt": 94, "current": (25, 225)},
    "aliceSprings": {"name": "Alice Springs, Australia", "lat": -23.6980, "lon": 133.8807, "alt": 545, "current": (10, 45)},
    "tokyo": {"name": "Tokyo, Japan", "lat": 35.6762, "lon": 139.6503, "alt": 40, "current": (30, 160)},
}

def bump(center, peak, width):
    d = (AZ - center + 180) % 360 - 180
    return peak * np.exp(-0.5 * (d / width) ** 2)

def horizon_at(prof, az):
    x = np.mod(az, 360) / 5; i = np.floor(x).astype(int) % 72; fr = x - np.floor(x)
    return prof[i] * (1 - fr) + prof[(i + 1) % 72] * fr

def svf(prof, tilt, az, n=3600):
    phi = (np.arange(n) + 0.5) * 360 / n
    S, A = np.radians(tilt), np.radians(az)
    c = np.cos(np.radians(phi) - A)
    e_plane = np.arctan(-np.tan(S) * c) if tilt < 90 else np.where(c > 0, -np.pi / 2, np.where(c < 0, np.pi / 2, 0))
    H = np.pi / 2 - np.maximum(np.radians(horizon_at(prof, phi)), e_plane)
    return float(np.mean(np.cos(S) * np.sin(H) ** 2 + np.sin(S) * c * (H - np.sin(H) * np.cos(H))))

out = {"meta": {"pvlib": pvlib.__version__, "linkeTurbidity": TL, "albedo": ALBEDO, "kWp": KWP, "performanceRatio": PR,
                "transposition": "haydavies"}, "sites": {}}

for key, s in SITES.items():
    loc = pvlib.location.Location(s["lat"], s["lon"], "UTC", s["alt"])
    sp = loc.get_solarposition(TIMES)
    ext = irradiance.get_extra_radiation(TIMES)
    cs = loc.get_clearsky(TIMES, model="ineichen", linke_turbidity=TL, dni_extra=ext)
    zen, saz = sp.apparent_zenith.values, sp.azimuth.values
    ghi, dni, dhi, e0 = cs.ghi.values, cs.dni.values, cs.dhi.values, ext.values
    month = TIMES.month.values - 1
    day = ghi > 0

    def monthly(tilt, az, prof=None):
        if prof is None:
            r = irradiance.get_total_irradiance(tilt, az, zen, saz, dni, ghi, dhi, dni_extra=e0, model="haydavies", albedo=ALBEDO)
            poa = np.nan_to_num(np.asarray(r["poa_global"], dtype=float))
        else:
            v = (90 - zen > horizon_at(prof, saz)).astype(float)
            proj = irradiance.aoi_projection(tilt, az, zen, saz)
            ai = dni / e0
            rb = np.maximum(proj, 0) / np.maximum(np.cos(np.radians(zen)), 0.01745)
            poa = (v * np.maximum(dni * proj, 0) + np.maximum(dhi * (1 - ai) * svf(prof, tilt, az), 0)
                   + v * np.maximum(dhi * ai * rb, 0)
                   + (v * dni * np.maximum(np.cos(np.radians(zen)), 0) + dhi * svf(prof, 0, 0)) * ALBEDO * (1 - np.cos(np.radians(tilt))) / 2)
        poa = np.where(day, poa, 0)
        return np.bincount(month, weights=poa, minlength=12) / 1000

    eq = 180 if s["lat"] >= 0 else 0
    best = None
    for tilt in range(0, 91, 1):
        for az in range(eq - 30, eq + 31, 2):
            a = monthly(tilt, az % 360).sum()
            if best is None or a > best[2]: best = (tilt, az % 360, a)
    opt_tilt, opt_az, _ = best
    if opt_tilt == 0: opt_az = eq
    m_opt = monthly(opt_tilt, opt_az)
    ct, ca = s["current"]
    m_cur = monthly(ct, ca)
    # synthetic terrain: a ridge on the equator-facing side, slightly east, plus a low ring
    prof = np.maximum(bump((eq - 25) % 360, 28, 35), np.full(72, 3.0))
    m_cur_sh = monthly(ct, ca, prof)
    m_opt_sh_at_open = monthly(opt_tilt, opt_az, prof)
    loss = (m_opt.sum() - m_cur.sum()) / m_opt.sum() * 100
    out["sites"][key] = {
        **{k: s[k] for k in ("name", "lat", "lon", "alt")},
        "optimum": {"tilt": opt_tilt, "azimuth": opt_az, "monthly": m_opt.tolist(), "annual": float(m_opt.sum())},
        "current": {"tilt": ct, "azimuth": ca, "monthly": m_cur.tolist(), "dailyAvg": (m_cur / DAYS).tolist(), "annual": float(m_cur.sum())},
        "lossAnnualPct": float(loss),
        "lossMonthlyPct": ((m_opt - m_cur) / m_opt * 100).tolist(),
        "energyCurrentKWh": float(m_cur.sum() * KWP * PR),
        "energyOptimumKWh": float(m_opt.sum() * KWP * PR),
        "terrain": {"profile": prof.tolist(), "currentMonthly": m_cur_sh.tolist(), "currentAnnual": float(m_cur_sh.sum()),
                    "optimumOrientationAnnual": float(m_opt_sh_at_open.sum()),
                    "terrainLossPct": float((m_cur.sum() - m_cur_sh.sum()) / m_cur.sum() * 100)},
    }
    print(f"{key:13s} opt {opt_tilt:2d}°/{opt_az:3d}° {m_opt.sum():6.0f}  current {ct}/{ca} {m_cur.sum():6.0f}  loss {loss:5.1f}%  terrain {out['sites'][key]['terrain']['terrainLossPct']:.1f}%")

json.dump(out, open("src/core/__fixtures__/integration.json", "w"), indent=1)
print("written")
