import {
  DEFAULT_TERRAIN, computeHorizon, curvatureDrop, destination, distanceBetween, elevationAngle, rayDistances,
  type LatLon,
} from "../terrain";
import { createTracer, traced } from "../trace";
import { close } from "./helpers";

const SITE: LatLon = { lat: 46.5, lon: 8.0 };
const sampler = (fn: (p: LatLon) => number) => async (pts: LatLon[]) => pts.map(fn);

describe("terrain geometry", () => {
  it("log-spaced distances cover min..max", () => {
    const d = rayDistances(DEFAULT_TERRAIN);
    expect(d.length).toBe(24);
    close(d[0], 150, 1e-12);
    close(d[23], 30_000, 1e-12);
    for (let i = 1; i < d.length; i++) close(d[i] / d[i - 1], d[1] / d[0], 1e-9);
  });
  it("great-circle destination: 1° of longitude at the equator, and round trip distance", () => {
    const p = destination({ lat: 0, lon: 0 }, 90, (Math.PI / 180) * 6_371_008.8);
    close(p.lat, 0, 0, 1e-9);
    close(p.lon, 1, 1e-9);
    for (const b of [0, 45, 133, 270]) close(distanceBetween(SITE, destination(SITE, b, 12_345)), 12_345, 1e-6);
    expect(destination({ lat: 0, lon: 179.9 }, 90, 50_000).lon).toBeLessThan(-179); // wraps the antimeridian
  });
  it("curvature drop at 30 km is about 61 m with k = 0.13 (70.6 m without refraction)", () => {
    close(curvatureDrop(30_000), 61.45, 1e-3);
    close(curvatureDrop(30_000, 0), 70.63, 1e-3);
    close(curvatureDrop(10_000), curvatureDrop(30_000) / 9, 1e-12);
  });
  it("elevation angle of a 500 m higher point 5 km away", () => {
    close(elevationAngle(1500, 1000, 5000), Math.atan2(500 - curvatureDrop(5000), 5000) * 180 / Math.PI, 1e-12);
  });
});

describe("computeHorizon with synthetic terrain", () => {
  it("flat plain gives a 0° horizon everywhere (negative angles clamped)", async () => {
    const h = await computeHorizon(SITE, 0, sampler(() => 500));
    expect(h.profile.elevations.every((e) => e === 0)).toBe(true);
    expect(h.points.every((p) => p.elevation <= 0)).toBe(true);
    expect(h.groundAltitude).toBe(500);
    expect(h.samplesUsed).toBe(1 + 72 * 24);
  });
  it("a ring plateau 300 m high beyond 2 km gives the exact angle at the nearest sample past 2 km", async () => {
    const terrain = (p: LatLon) => (distanceBetween(SITE, p) >= 2000 ? 800 : 500);
    const h = await computeHorizon(SITE, 0, sampler(terrain));
    const d1 = rayDistances(DEFAULT_TERRAIN).find((d) => d >= 2000 + 1e-6)!;
    const expected = elevationAngle(800, 500, d1);
    for (const p of h.points) {
      close(p.elevation, expected, 1e-9);
      close(p.distance, d1, 1e-9);
    }
  });
  it("panel height lowers the horizon", async () => {
    const terrain = (p: LatLon) => (distanceBetween(SITE, p) >= 2000 ? 800 : 500);
    const ground = await computeHorizon(SITE, 0, sampler(terrain));
    const roof = await computeHorizon(SITE, 50, sampler(terrain));
    expect(roof.observerAltitude).toBe(550);
    expect(roof.profile.elevations[0]).toBeLessThan(ground.profile.elevations[0]);
  });
  it("a cone hill 5 km east appears in the east only, close to the brute-force angle", async () => {
    const peak = destination(SITE, 90, 5000);
    const cone = (p: LatLon) => 400 + Math.max(0, 1200 - (1200 / 2500) * distanceBetween(peak, p));
    const h = await computeHorizon(SITE, 0, sampler(cone));
    const east = h.points[90 / 5], west = h.points[270 / 5];
    // brute force along the east ray at 1 m resolution
    let bf = -90;
    for (let d = 150; d <= 30_000; d += 1) bf = Math.max(bf, elevationAngle(cone(destination(SITE, 90, d)), 400, d));
    expect(east.elevation).toBeLessThanOrEqual(bf + 1e-9);
    expect(bf - east.elevation).toBeLessThan(1.5); // log sampling may miss the exact summit
    expect(east.distance).toBeGreaterThan(3000);
    expect(east.distance).toBeLessThan(6000);
    expect(h.profile.elevations[270 / 5]).toBe(0);
    expect(west.elevation).toBeLessThanOrEqual(0);
    const top = h.points.reduce((a, b) => (b.elevation > a.elevation ? b : a));
    expect(top.azimuth).toBe(90);
  });
  it("rejects incomplete elevation data", async () => {
    await expect(computeHorizon(SITE, 0, async (pts) => pts.slice(1).map(() => 0))).rejects.toThrow(/incomplete/);
    await expect(computeHorizon(SITE, 0, async (pts) => pts.map(() => NaN))).rejects.toThrow(/incomplete/);
  });
  it("trace records site, observer, curvature and the highest point", async () => {
    const t = createTracer();
    const h = await computeHorizon(SITE, 6, sampler((p) => (distanceBetween(SITE, p) >= 2000 ? 800 : 500)), {}, t);
    expect(traced(t, "terrain.ground")).toBe(500);
    expect(traced(t, "terrain.observer")).toBe(506);
    close(traced(t, "terrain.drop30"), 61.45, 1e-3);
    expect(traced(t, "terrain.highest")).toBe(Math.max(...h.points.map((p) => p.elevation)));
  });
});
