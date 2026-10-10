import { angleDiff, dayOfYearUTC, wrap360, cosd, sind, clamp } from "../math";
import { fmt } from "../trace";

describe("math helpers", () => {
  it("wraps angles to [0,360)", () => {
    expect(wrap360(370)).toBe(10);
    expect(wrap360(-10)).toBe(350);
    expect(wrap360(360)).toBe(0);
  });
  it("signed angle difference is the shortest way round", () => {
    expect(angleDiff(10, 350)).toBe(20);
    expect(angleDiff(350, 10)).toBe(-20);
    expect(angleDiff(180, 0)).toBe(180);
    expect(angleDiff(90, 270)).toBe(180);
  });
  it("day of year", () => {
    expect(dayOfYearUTC(Date.UTC(2025, 0, 1, 0, 30))).toBe(1);
    expect(dayOfYearUTC(Date.UTC(2025, 11, 31, 23, 30))).toBe(365);
    expect(dayOfYearUTC(Date.UTC(2025, 2, 21, 12))).toBe(80);
  });
  it("trig in degrees and clamp", () => {
    expect(cosd(60)).toBeCloseTo(0.5, 12);
    expect(sind(30)).toBeCloseTo(0.5, 12);
    expect(clamp(5, 0, 1)).toBe(1);
  });
  it("formats numbers for formulas", () => {
    expect(fmt(1.23456789)).toBe("1.2346");
    expect(fmt(0)).toBe("0");
    expect(fmt(123456)).toBe("1.235e+5");
  });
});
