import { flatHorizon } from "../core";
import { horizonKey, parseCached } from "./horizonCache";

describe("horizon cache", () => {
  it("key rounds the site to 4 decimals and height to 0.1 m", () => {
    expect(horizonKey(40.416812, -3.703789, 6)).toBe("40.4168,-3.7038,6.0");
    expect(horizonKey(40.41681, -3.70379, 6.04)).toBe(horizonKey(40.416812, -3.703789, 6));
    expect(horizonKey(40.4168, -3.7038, 0)).not.toBe(horizonKey(40.4168, -3.7038, 6));
  });
  it("parses a valid entry and rejects corrupt ones", () => {
    const ok = { profile: flatHorizon(), source: "terrain", computedAt: 1 };
    expect(parseCached(JSON.stringify(ok))?.profile.elevations.length).toBe(72);
    expect(parseCached(JSON.stringify({ ...ok, source: "x" }))?.source).toBe("terrain");
    expect(parseCached(null)).toBeNull();
    expect(parseCached("{bad")).toBeNull();
    expect(parseCached(JSON.stringify({ profile: { stepDeg: 5, elevations: [1] } }))).toBeNull();
    expect(parseCached(JSON.stringify({ ...ok, points: [1, 2] }))).toBeNull();
  });
});
