"""Generate reference values with pvlib-python for the TypeScript unit tests.

Run:  python reference/generate_fixtures.py
Writes src/core/__fixtures__/pvlib.json
"""
import json, numpy as np, pandas as pd, pvlib
from pvlib import irradiance, atmosphere, clearsky

TL, ALBEDO = 3.0, 0.2
SITES = {
    "madrid": (40.4168, -3.7038, 667),
    "oslo": (59.9139, 10.7522, 23),
    "sydney": (-33.8688, 151.2093, 58),
    "quito": (-0.1807, -78.4678, 2850),
    "denver": (39.7392, -104.9903, 1609),
}
ORIENTATIONS = [(0, 180), (35, 180), (35, 90), (60, 225), (90, 180), (20, 0), (30, 300)]
TIMES = pd.date_range("2025-01-01 00:30", "2025-12-31 23:30", freq="h", tz="UTC")

def year_inputs(lat, lon, alt):
    loc = pvlib.location.Location(lat, lon, "UTC", alt)
    sp = loc.get_solarposition(TIMES)  # pressure from altitude, temperature 12 C
    dni_extra = irradiance.get_extra_radiation(TIMES)  # spencer, 1366.1
    cs = loc.get_clearsky(TIMES, model="ineichen", linke_turbidity=TL, dni_extra=dni_extra)
    return loc, sp, dni_extra, cs

def poa(sp, cs, dni_extra, tilt, az, model):
    r = irradiance.get_total_irradiance(tilt, az, sp.apparent_zenith, sp.azimuth,
                                        cs.dni, cs.ghi, cs.dhi, dni_extra=dni_extra,
                                        model=model, albedo=ALBEDO)
    return r.fillna(0)

out = {"meta": {"pvlib": pvlib.__version__, "linkeTurbidity": TL, "albedo": ALBEDO,
                "year": 2025, "timestamps": "hourly at hh:30 UTC"}, "sites": {}}

# Pure-function checks (no time series)
p = atmosphere.alt2pres(np.array([0, 667, 1609, 2850]))
z = np.array([0, 30, 60, 80, 85, 89])
am = atmosphere.get_relative_airmass(z, model="kastenyoung1989")
doys = [1, 80, 172, 266, 355]
ea = [float(irradiance.get_extra_radiation(d)) for d in doys]
cases = []
for (zen, ama, tl, alt) in [(30, 1.15, 3, 0), (60, 2.0, 3, 667), (75, 3.8, 4.5, 1609), (10, 0.75, 2, 2850)]:
    r = clearsky.ineichen(np.array([zen]), np.array([ama]), tl, altitude=alt, dni_extra=1366.1)
    cases.append({"apparentZenith": zen, "airmassAbsolute": ama, "linkeTurbidity": tl, "altitude": alt,
                  "dniExtra": 1366.1, "ghi": float(r["ghi"][0]), "dni": float(r["dni"][0]), "dhi": float(r["dhi"][0])})
aoi_cases = []
for (tilt, saz, zen, az) in [(35, 180, 40, 180), (35, 180, 60, 120), (90, 90, 70, 250), (0, 180, 50, 100), (20, 0, 30, 200)]:
    proj = float(irradiance.aoi_projection(tilt, saz, zen, az))
    hd = irradiance.haydavies(tilt, saz, 120.0, 800.0, 1360.0, zen, az, return_components=True)
    aoi_cases.append({"tilt": tilt, "surfaceAzimuth": saz, "zenith": zen, "azimuth": az,
                      "aoiProjection": proj, "aoi": float(irradiance.aoi(tilt, saz, zen, az)),
                      "dhi": 120.0, "dni": 800.0, "dniExtra": 1360.0,
                      "hdIsotropic": float(hd["poa_isotropic"]), "hdCircumsolar": float(hd["poa_circumsolar"]),
                      "isotropic": float(irradiance.isotropic(tilt, 120.0)),
                      "ground": float(irradiance.get_ground_diffuse(tilt, 700.0, ALBEDO))})
out["pure"] = {"alt2pres": {"altitude": [0, 667, 1609, 2850], "pressure": p.tolist()},
               "airmass": {"zenith": z.tolist(), "relative": am.tolist()},
               "extraRadiation": {"doy": doys, "value": ea},
               "ineichen": cases, "planeOfArray": aoi_cases}

for name, (lat, lon, alt) in SITES.items():
    loc, sp, dni_extra, cs = year_inputs(lat, lon, alt)
    am = loc.get_airmass(TIMES, solar_position=sp)
    # hourly samples: a few daytime hours across the year
    samples = []
    idx = [i for i in range(0, 8760, 263) if cs.ghi.iloc[i] > 0][:16]
    for i in idx:
        r = poa(sp, cs, dni_extra, 35, 180 if lat >= 0 else 0, "haydavies")
        hd = irradiance.haydavies(35, 180 if lat >= 0 else 0, cs.dhi.iloc[i], cs.dni.iloc[i], dni_extra.iloc[i],
                                  sp.apparent_zenith.iloc[i], sp.azimuth.iloc[i], return_components=True)
        samples.append({
            "epochMs": int(TIMES[i].value // 10**6),
            "zenith": float(sp.zenith.iloc[i]), "apparentZenith": float(sp.apparent_zenith.iloc[i]),
            "azimuth": float(sp.azimuth.iloc[i]), "dniExtra": float(dni_extra.iloc[i]),
            "airmassRelative": float(am.airmass_relative.iloc[i]),
            "airmassAbsolute": float(am.airmass_absolute.iloc[i]),
            "ghi": float(cs.ghi.iloc[i]), "dni": float(cs.dni.iloc[i]), "dhi": float(cs.dhi.iloc[i]),
            "tilt": 35, "surfaceAzimuth": 180 if lat >= 0 else 0,
            "poaDirect": float(r.poa_direct.iloc[i]), "poaSkyDiffuse": float(r.poa_sky_diffuse.iloc[i]),
            "poaCircumsolar": float(hd["poa_circumsolar"]), "poaIsotropic": float(hd["poa_isotropic"]),
            "poaGround": float(r.poa_ground_diffuse.iloc[i]), "poaGlobal": float(r.poa_global.iloc[i])})
    yearly = []
    for tilt, az in ORIENTATIONS:
        for model in ("haydavies", "isotropic"):
            r = poa(sp, cs, dni_extra, tilt, az, model).poa_global
            monthly = (r.groupby(r.index.month).sum() / 1000).tolist()
            yearly.append({"tilt": tilt, "azimuth": az, "model": model, "monthly": monthly,
                           "annual": float(r.sum() / 1000)})
    # optimum by brute force (1 deg tilt, 1 deg azimuth around equator-facing)
    eq = 180 if lat >= 0 else 0
    best = (None, -1)
    for tilt in range(0, 91, 1):
        for az in range(eq - 30, eq + 31, 2):
            v = poa(sp, cs, dni_extra, tilt, az % 360, "haydavies").poa_global.sum() / 1000
            if v > best[1]: best = ((tilt, az % 360), v)
    out["sites"][name] = {"lat": lat, "lon": lon, "altitude": alt, "samples": samples, "yearly": yearly,
                          "optimum": {"tilt": best[0][0], "azimuth": best[0][1], "annual": float(best[1])}}
    print(name, "optimum", best)

with open("src/core/__fixtures__/pvlib.json", "w") as f:
    json.dump(out, f, indent=1)
print("written")
