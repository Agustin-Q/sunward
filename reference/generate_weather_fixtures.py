"""Reference for the real-weather pipeline (NASA POWER-style hourly data).

Builds a deterministic synthetic "cloudy" year (no network needed): pvlib clear sky
modulated by a seeded daily/hourly cloud factor, split into DNI/DHI. Then computes
plane-of-array totals with pvlib from exactly that data, with pvlib's own sun
positions at hh:30 UTC and irradiance set to 0 when the sun is below the horizon
(the same rule as seriesHour()).

Sites: Alicante and Buenos Aires (mandatory sites).
Run: python reference/generate_weather_fixtures.py -> src/core/__fixtures__/weather.json
"""
import json, numpy as np, pandas as pd, pvlib
from pvlib import irradiance

TIMES_START = pd.date_range("2025-01-01 00:00", "2025-12-31 23:00", freq="h", tz="UTC")
TIMES_MID = TIMES_START + pd.Timedelta(minutes=30)
SITES = {"alicante": (38.3452, -0.4810, 10), "buenosAires": (-34.6037, -58.3816, 25)}
ORIENT = [(35, 180), (20, 0), (30, 90), (0, 180)]

out = {"meta": {"pvlib": pvlib.__version__, "albedo": 0.2, "label": "synthetic NASA-style year"}, "sites": {}}
for name, (lat, lon, alt) in SITES.items():
    rng = np.random.default_rng(abs(hash(name)) % 2**32 if False else (1 if name == "alicante" else 2))
    loc = pvlib.location.Location(lat, lon, "UTC", alt)
    sp = loc.get_solarposition(TIMES_MID)
    ext = irradiance.get_extra_radiation(TIMES_MID)
    cs = loc.get_clearsky(TIMES_MID, model="ineichen", linke_turbidity=3.0, dni_extra=ext)
    day_cloud = np.repeat(rng.uniform(0.15, 1.0, 365), 24)          # daily cloudiness
    hour_jit = rng.uniform(0.85, 1.0, 8760)
    k = np.clip(day_cloud * hour_jit, 0, 1)
    ghi = cs.ghi.values * (0.25 + 0.75 * k)
    dni = cs.dni.values * k ** 1.6
    cosz = np.maximum(np.cos(np.radians(sp.apparent_zenith.values)), 0)
    dhi = np.maximum(ghi - dni * cosz, 0)
    # store as integers W/m² (what the app's cache keeps)
    ghi_i, dni_i, dhi_i = (np.round(a).astype(int) for a in (ghi, dni, dhi))
    up = sp.apparent_zenith.values < 90
    g, b, d = (np.where(up, a, 0).astype(float) for a in (ghi_i, dni_i, dhi_i))
    yearly = []
    for tilt, az in ORIENT:
        r = irradiance.get_total_irradiance(tilt, az, sp.apparent_zenith, sp.azimuth, b, g, d, dni_extra=ext, model="haydavies", albedo=0.2)
        poa = np.nan_to_num(np.asarray(r["poa_global"], dtype=float))
        poa = np.where(g > 0, poa, 0)
        m = np.bincount(TIMES_MID.month.values - 1, weights=poa, minlength=12) / 1000
        yearly.append({"tilt": tilt, "azimuth": az, "monthly": m.tolist(), "annual": float(m.sum())})
    cs_annual = float(np.where(up, cs.ghi.values, 0).sum() / 1000)
    out["sites"][name] = {"lat": lat, "lon": lon, "alt": alt, "ghi": ghi_i.tolist(), "dni": dni_i.tolist(), "dhi": dhi_i.tolist(),
                          "yearly": yearly, "clearSkyGhiAnnual": cs_annual, "dataGhiAnnual": float(g.sum() / 1000)}
    print(name, round(yearly[0]["annual"]), "vs clear-sky GHI", round(cs_annual), "data GHI", round(g.sum() / 1000))
json.dump(out, open("src/core/__fixtures__/weather.json", "w"), separators=(",", ":"))
print("written")
