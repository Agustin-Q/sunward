import { DEG, clamp, cosd, sind } from "./math";
import { fmt as f } from "./trace";
import type { Tracer } from "./trace";
import type { Irradiance } from "./clearsky";
import type { Orientation, TranspositionModel } from "./types";
import type { ShadeFactors } from "./horizon";

/** Lower bound on cos θz in Rb, = cos(89°) — pvlib GH 432. */
export const RB_COSZ_MIN = 0.01745;

/**
 * cos of the angle of incidence between sun and panel normal (pvlib.irradiance.aoi_projection).
 * cos θ = cos β · cos θz + sin β · sin θz · cos(γs − γ), clipped to [−1, 1].
 */
export function aoiProjection(tilt: number, surfaceAzimuth: number, zenith: number, azimuth: number, t?: Tracer): number {
  const v = clamp(cosd(tilt) * cosd(zenith) + sind(tilt) * sind(zenith) * cosd(azimuth - surfaceAzimuth), -1, 1);
  t?.add({
    key: "poa.cosAoi",
    label: "Cosine of angle of incidence",
    symbol: "cos θ",
    formula: "cos β · cos θz′ + sin β · sin θz′ · cos(γs − γ)",
    substituted: `cos ${f(tilt)}° · cos ${f(zenith)}° + sin ${f(tilt)}° · sin ${f(zenith)}° · cos(${f(azimuth)}° − ${f(surfaceAzimuth)}°)`,
    value: v,
    unit: "–",
  });
  t?.add({ key: "poa.aoi", label: "Angle of incidence", symbol: "θ", formula: "acos(cos θ)", substituted: `acos(${f(v)})`, value: Math.acos(v) / DEG, unit: "°" });
  return v;
}

export interface PoaComponents {
  /** Beam on the panel */
  direct: number;
  /** Circumsolar diffuse (0 for isotropic model) */
  circumsolar: number;
  /** Isotropic sky diffuse */
  isotropic: number;
  /** Total sky diffuse = circumsolar + isotropic */
  skyDiffuse: number;
  /** Ground-reflected */
  ground: number;
  /** Total plane-of-array irradiance */
  global: number;
}

/**
 * Plane-of-array irradiance (pvlib.irradiance.get_total_irradiance).
 * Beam:      Eb = max(DNI · cos θ, 0)
 * Hay-Davies: Ai = DNI/I₀, Rb = max(cos θ,0)/max(cos θz′, cos 89°),
 *            Ed = DHI · Ai · Rb + DHI · (1−Ai) · (1+cos β)/2
 * Isotropic: Ed = DHI · (1+cos β)/2
 * Ground:    Eg = GHI · ρ · (1−cos β)/2
 * With terrain shading (optional `shade`): beam and circumsolar × v (sun above
 * skyline), Fsky → sky view factor with horizon, ground uses
 * GHI_h = v·DNI·cos θz′ + DHI·Fsky,h(0). Without `shade` the result is pvlib's exactly.
 */
export function planeOfArray(
  o: Orientation,
  apparentZenith: number,
  sunAzimuth: number,
  irr: Irradiance,
  dniExtra: number,
  albedo: number,
  model: TranspositionModel,
  t?: Tracer,
  shade?: ShadeFactors,
): PoaComponents {
  const cosT = aoiProjection(o.tilt, o.azimuth, apparentZenith, sunAzimuth, t);
  const v = shade ? (shade.sunVisible ? 1 : 0) : 1;
  const direct = v * Math.max(irr.dni * cosT, 0);
  t?.add(shade
    ? { key: "poa.direct", label: "Beam on panel", symbol: "Eb", formula: "v · max(DNI · cos θ, 0)", substituted: `${v} · max(${f(irr.dni, 2)} · ${f(cosT)}, 0)`, value: direct, unit: "W/m²" }
    : { key: "poa.direct", label: "Beam on panel", symbol: "Eb", formula: "max(DNI · cos θ, 0)", substituted: `max(${f(irr.dni, 2)} · ${f(cosT)}, 0)`, value: direct, unit: "W/m²" });

  const cosB = cosd(o.tilt);
  const view = shade ? shade.skyView : 0.5 * (1 + cosB);
  t?.add(shade
    ? { key: "poa.skyView", label: "Sky view factor (with horizon)", symbol: "Fsky,h", formula: "Dozier & Frew, see Terrain shading", substituted: "", value: view, unit: "–" }
    : { key: "poa.skyView", label: "Sky view factor", symbol: "Fsky", formula: "(1 + cos β) / 2", substituted: `(1 + cos ${f(o.tilt)}°) / 2`, value: view, unit: "–" });

  let circumsolar = 0;
  let isotropic: number;
  if (model === "haydavies") {
    const cosZ = cosd(apparentZenith);
    const rb = Math.max(cosT, 0) / Math.max(cosZ, RB_COSZ_MIN);
    const ai = irr.dni / dniExtra;
    isotropic = Math.max(irr.dhi * (1 - ai) * view, 0);
    circumsolar = v * Math.max(irr.dhi * ai * rb, 0);
    if (t) {
      t.add({ key: "poa.rb", label: "Beam tilt ratio", symbol: "Rb", formula: "max(cos θ, 0) / max(cos θz′, 0.01745)", substituted: `${f(Math.max(cosT, 0))} / ${f(Math.max(cosZ, RB_COSZ_MIN))}`, value: rb, unit: "–" });
      t.add({ key: "poa.ai", label: "Anisotropy index", symbol: "Ai", formula: "DNI / I₀", substituted: `${f(irr.dni, 2)} / ${f(dniExtra, 2)}`, value: ai, unit: "–" });
      t.add(shade
        ? { key: "poa.circumsolar", label: "Circumsolar diffuse", symbol: "Ed,cs", formula: "v · DHI · Ai · Rb", substituted: `${v} · ${f(irr.dhi, 2)} · ${f(ai)} · ${f(rb)}`, value: circumsolar, unit: "W/m²" }
        : { key: "poa.circumsolar", label: "Circumsolar diffuse", symbol: "Ed,cs", formula: "DHI · Ai · Rb", substituted: `${f(irr.dhi, 2)} · ${f(ai)} · ${f(rb)}`, value: circumsolar, unit: "W/m²" });
      t.add({ key: "poa.isotropic", label: "Isotropic sky diffuse", symbol: "Ed,iso", formula: `DHI · (1 − Ai) · ${shade ? "Fsky,h" : "Fsky"}`, substituted: `${f(irr.dhi, 2)} · (1 − ${f(ai)}) · ${f(view)}`, value: isotropic, unit: "W/m²" });
    }
  } else {
    isotropic = Math.max(irr.dhi * view, 0);
    t?.add({ key: "poa.isotropic", label: "Isotropic sky diffuse", symbol: "Ed,iso", formula: `DHI · ${shade ? "Fsky,h" : "Fsky"}`, substituted: `${f(irr.dhi, 2)} · ${f(view)}`, value: isotropic, unit: "W/m²" });
  }
  const skyDiffuse = circumsolar + isotropic;
  t?.add({ key: "poa.skyDiffuse", label: "Sky diffuse on panel", symbol: "Ed", formula: "Ed,cs + Ed,iso", substituted: `${f(circumsolar, 2)} + ${f(isotropic, 2)}`, value: skyDiffuse, unit: "W/m²" });

  let ground: number;
  if (shade) {
    // The ground in front of the panel also sees less sun and sky.
    const cosZ = Math.max(cosd(apparentZenith), 0);
    const ghiH = v * irr.dni * cosZ + irr.dhi * shade.skyViewHorizontal;
    ground = ghiH * albedo * (1 - cosB) * 0.5;
    t?.add({ key: "poa.ghiShaded", label: "Light on the ground (with horizon)", symbol: "GHI_h", formula: "v · DNI · cos θz′ + DHI · Fsky,h(0)", substituted: `${v} · ${f(irr.dni, 2)} · ${f(cosZ)} + ${f(irr.dhi, 2)} · ${f(shade.skyViewHorizontal)}`, value: ghiH, unit: "W/m²" });
    t?.add({ key: "poa.ground", label: "Ground-reflected", symbol: "Eg", formula: "GHI_h · ρ · (1 − cos β) / 2", substituted: `${f(ghiH, 2)} · ${f(albedo)} · (1 − cos ${f(o.tilt)}°) / 2`, value: ground, unit: "W/m²" });
  } else {
    ground = irr.ghi * albedo * (1 - cosB) * 0.5;
    t?.add({ key: "poa.ground", label: "Ground-reflected", symbol: "Eg", formula: "GHI · ρ · (1 − cos β) / 2", substituted: `${f(irr.ghi, 2)} · ${f(albedo)} · (1 − cos ${f(o.tilt)}°) / 2`, value: ground, unit: "W/m²" });
  }

  const global = direct + skyDiffuse + ground;
  t?.add({ key: "poa.global", label: "Total on panel (POA)", symbol: "POA", formula: "Eb + Ed + Eg", substituted: `${f(direct, 2)} + ${f(skyDiffuse, 2)} + ${f(ground, 2)}`, value: global, unit: "W/m²" });
  return { direct, circumsolar, isotropic, skyDiffuse, ground, global };
}
