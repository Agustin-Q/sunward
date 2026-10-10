import { DEG, clamp, cosd, dayOfYearUTC, sind } from "./math";
import { fmt as f, type Tracer } from "./trace";
import type { Site } from "./types";

export interface TextbookSun {
  declination: number;
  equationOfTimeMin: number;
  solarTimeH: number;
  hourAngle: number;
  zenith: number;
}

/**
 * Textbook approximation of the sun's position — for learning and as a
 * sanity check in the debug view. NOT used for results (SPA is).
 * Accuracy ≈ ±1°.
 *  δ = 23.45° · sin(360° · (284 + n) / 365)         (Cooper 1969)
 *  EoT = 229.18 · (0.000075 + 0.001868 cos B − 0.032077 sin B − 0.014615 cos 2B − 0.040849 sin 2B) min (Spencer)
 *  t_solar = UTC + λ/15 + EoT/60
 *  ω = 15° · (t_solar − 12)
 *  cos θz = sin φ sin δ + cos φ cos δ cos ω
 */
export function textbookSun(epochMs: number, site: Site, t?: Tracer): TextbookSun {
  const n = dayOfYearUTC(epochMs);
  const d = new Date(epochMs);
  const utcH = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
  const declination = 23.45 * sind((360 * (284 + n)) / 365);
  const B = (2 * Math.PI * (n - 1)) / 365;
  const eot = 229.18 * (0.000075 + 0.001868 * Math.cos(B) - 0.032077 * Math.sin(B) - 0.014615 * Math.cos(2 * B) - 0.040849 * Math.sin(2 * B));
  let solarTimeH = utcH + site.lon / 15 + eot / 60;
  solarTimeH = ((solarTimeH % 24) + 24) % 24;
  const hourAngle = 15 * (solarTimeH - 12);
  const cz = clamp(sind(site.lat) * sind(declination) + cosd(site.lat) * cosd(declination) * cosd(hourAngle), -1, 1);
  const zenith = Math.acos(cz) / DEG;
  if (t) {
    t.add({ key: "tb.declination", label: "Declination (Cooper)", symbol: "δ", formula: "23.45° · sin(360° · (284 + n) / 365)", substituted: `23.45 · sin(360 · (284 + ${n}) / 365)`, value: declination, unit: "°" });
    t.add({ key: "tb.eot", label: "Equation of time", symbol: "EoT", formula: "229.18 · (0.000075 + 0.001868 cos B − 0.032077 sin B − 0.014615 cos 2B − 0.040849 sin 2B)", substituted: `B = ${f(B)}`, value: eot, unit: "min" });
    t.add({ key: "tb.solarTime", label: "Local solar time", symbol: "t_s", formula: "UTC + λ/15 + EoT/60", substituted: `${f(utcH)} + ${f(site.lon)}/15 + ${f(eot)}/60`, value: solarTimeH, unit: "h" });
    t.add({ key: "tb.hourAngle", label: "Hour angle", symbol: "ω", formula: "15° · (t_s − 12)", substituted: `15 · (${f(solarTimeH)} − 12)`, value: hourAngle, unit: "°" });
    t.add({ key: "tb.zenith", label: "Zenith (approx.)", symbol: "θz≈", formula: "acos(sin φ sin δ + cos φ cos δ cos ω)", substituted: `acos(sin ${f(site.lat)}° sin ${f(declination)}° + cos ${f(site.lat)}° cos ${f(declination)}° cos ${f(hourAngle)}°)`, value: zenith, unit: "°" });
  }
  return { declination, equationOfTimeMin: eot, solarTimeH, hourAngle, zenith };
}
