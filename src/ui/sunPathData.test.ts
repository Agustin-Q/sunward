import { flatHorizon } from "../core";
import { hiddenShare, splitByHorizon, sunPaths } from "./sunPathData";

const madrid = { lat: 40.4168, lon: -3.7038, altitude: 667 };

describe("sun-path data", () => {
  const paths = sunPaths(madrid);
  it("June path is highest, December lowest; noon elevations match 90 − φ ± 23.4", () => {
    const max = (i: number) => Math.max(...paths[i].points.map((p) => p.elevation));
    expect(paths[0].label).toBe("Jun 21");
    expect(max(0)).toBeCloseTo(90 - 40.4168 + 23.44, 0);
    expect(max(6)).toBeCloseTo(90 - 40.4168 - 23.44, 0);
    for (let i = 1; i < paths.length; i++) expect(max(i)).toBeLessThan(max(i - 1));
  });
  it("noon mark is near due south; hour marks are whole mean-solar hours", () => {
    const noon = paths[3].hours.find((h) => h.hour === 12)!;
    expect(Math.abs(noon.azimuth - 180)).toBeLessThan(3); // equation of time ≈ +7 min on Mar 21 → under 2°
    expect(paths[0].hours.map((h) => h.hour)).toContain(6);
  });
  it("a flat horizon hides nothing; a 30° wall hides the December path", () => {
    expect(splitByHorizon(paths[6], flatHorizon()).every((r) => r.visible)).toBe(true);
    const wall = { stepDeg: 5, elevations: new Array(72).fill(30) };
    expect(hiddenShare(paths[6], wall)).toBe(1); // Dec noon sun ≈ 26°
    expect(hiddenShare(paths[0], wall)).toBeGreaterThan(0);
    expect(hiddenShare(paths[0], wall)).toBeLessThan(1);
  });
  it("runs alternate visible/hidden and share boundary points", () => {
    const wall = { stepDeg: 5, elevations: new Array(72).fill(30) };
    const runs = splitByHorizon(paths[0], wall);
    expect(runs.map((r) => r.visible)).toEqual([false, true, false]);
    expect(runs[1].points[0]).toBe(runs[0].points[runs[0].points.length - 1]);
  });
});

describe("sun paths at arbitrary longitudes (regression)", () => {
  it.each([0.16168, -58.3816, 139.6503, -119.7871, 133.8807])("longitude %s does not throw and gives 7 paths", (lon) => {
    const paths = sunPaths({ lat: 38.71729, lon, altitude: 320 });
    expect(paths).toHaveLength(7);
    expect(paths[0].points.length).toBeGreaterThan(0);
    for (const p of paths[0].points) expect(Number.isInteger(p.epochMs)).toBe(true);
  });
});
