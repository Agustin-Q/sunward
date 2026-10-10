import { compassPoint, dateToHourIndex, fmtSigned, heatScale, pointerAzimuth, rampColor, readNum } from "./helpers";

describe("UI helpers", () => {
  it("pointer azimuth: up = N (0), right = E (90), down = S (180), left = W (270)", () => {
    expect(pointerAzimuth(0, 0, 0, -10)).toBeCloseTo(0);
    expect(pointerAzimuth(0, 0, 10, 0)).toBeCloseTo(90);
    expect(pointerAzimuth(0, 0, 0, 10)).toBeCloseTo(180);
    expect(pointerAzimuth(0, 0, -10, 0)).toBeCloseTo(270);
  });
  it("compass points", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(180)).toBe("S");
    expect(compassPoint(202)).toBe("SSW");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(-90)).toBe("W");
  });
  it("ramp colour endpoints and clamping", () => {
    expect(rampColor(0)).toBe("#cde2fb");
    expect(rampColor(1)).toBe("#0d366b");
    expect(rampColor(-1)).toBe("#cde2fb");
    expect(rampColor(0.5)).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("heat scale", () => {
    expect(heatScale(100)).toBe(1);
    expect(heatScale(60)).toBe(0);
    expect(heatScale(30)).toBe(0);
    expect(heatScale(80)).toBeCloseTo(0.5);
  });
  it("hour index in the 2025 reference year", () => {
    expect(dateToHourIndex("2025-01-01", 0)).toBe(0);
    expect(dateToHourIndex("2025-01-02", 5)).toBe(29);
    expect(dateToHourIndex("2025-12-31", 23)).toBe(8759);
  });
  it("signed formatting and numeric input reading", () => {
    expect(fmtSigned(2.345)).toBe("+2.3");
    expect(fmtSigned(-1)).toBe("−1.0");
    expect(readNum("abc", 0, 10, 5)).toBe(5);
    expect(readNum("99", 0, 10, 5)).toBe(10);
  });
});
