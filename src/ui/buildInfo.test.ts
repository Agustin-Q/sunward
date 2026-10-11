import { commitUrl, formatBuild } from "./buildInfo";

describe("build stamp", () => {
  it("formats hash and commit date", () => {
    expect(formatBuild({ commit: "ec3a6cd", date: "2026-10-11T06:40:00Z" }, "en-GB", "Europe/Madrid")).toBe("ec3a6cd · 11 Oct 2026, 08:40");
  });
  it("falls back to the hash alone without a valid date", () => {
    expect(formatBuild({ commit: "dev", date: "" })).toBe("dev");
    expect(formatBuild({ commit: "abc1234", date: "nonsense" })).toBe("abc1234");
  });
  it("links real hashes to the commit, anything else to the repo", () => {
    expect(commitUrl({ commit: "ec3a6cd", date: "" })).toBe("https://github.com/Agustin-Q/sunward/commit/ec3a6cd");
    expect(commitUrl({ commit: "dev", date: "" })).toBe("https://github.com/Agustin-Q/sunward");
  });
});
