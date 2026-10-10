import { DEFAULTS, fromQuery, mergeState, resolveInitialState, sanitize, shareUrl, toQuery, type AppState } from "./appState";

const custom: AppState = {
  site: { lat: 59.91391, lon: 10.75222, altitude: 23 },
  siteIsExample: false,
  params: { linkeTurbidity: 3.4, albedo: 0.35, transposition: "isotropic" },
  sourceId: "clearsky",
  you: { tilt: 45, azimuth: 205 },
  sys: { kWp: 7.2, performanceRatio: 0.82 },
  unit: "kwh",
  tab: "debug",
  dbgDate: "2025-12-21",
  dbgHour: 11,
  dbgOrient: "opt",
};

describe("settings: query string", () => {
  it("round-trips every setting through the query string", () => {
    expect(mergeState(DEFAULTS, fromQuery(toQuery(custom)))).toEqual(custom);
  });
  it("accepts a leading '?'", () => {
    expect(mergeState(DEFAULTS, fromQuery("?" + toQuery(custom)))).toEqual(custom);
  });
  it("uses short, stable keys", () => {
    const q = new URLSearchParams(toQuery(custom));
    expect([...q.keys()]).toEqual(["lat", "lon", "alt", "tilt", "az", "kwp", "pr", "tl", "alb", "tm", "src", "unit", "tab", "dd", "dh", "do"]);
    expect(q.get("lat")).toBe("59.91391");
  });
  it("a partial link only changes what it names", () => {
    const s = mergeState(custom, fromQuery("tilt=30&az=180"));
    expect(s.you).toEqual({ tilt: 30, azimuth: 180 });
    expect(s.site).toEqual(custom.site);
    expect(s.sys).toEqual(custom.sys);
  });
  it("a link with a location clears the example flag", () => {
    expect(mergeState(DEFAULTS, fromQuery("lat=10&lon=20")).siteIsExample).toBe(false);
    expect(mergeState(DEFAULTS, fromQuery("tilt=10")).siteIsExample).toBe(true);
  });
  it("rejects or clamps bad values instead of breaking", () => {
    const s = mergeState(DEFAULTS, fromQuery("lat=999&lon=abc&tilt=-5&az=-90&pr=7&tm=bogus&src=pvgis&unit=x&dd=2025-02-30&dh=40&do=?"));
    expect(s.site.lat).toBe(89.9);
    expect(s.site.lon).toBe(DEFAULTS.site.lon);
    expect(s.you.tilt).toBe(0);
    expect(s.you.azimuth).toBe(270);
    expect(s.sys.performanceRatio).toBe(1);
    expect(s.params.transposition).toBe("haydavies");
    expect(s.sourceId).toBe("clearsky"); // not available yet
    expect(s.unit).toBe("month");
    expect(s.dbgDate).toBe(DEFAULTS.dbgDate);
    expect(s.dbgHour).toBe(23);
    expect(s.dbgOrient).toBe("you");
  });
  it("empty values and unknown keys are ignored", () => {
    expect(mergeState(custom, fromQuery("lat=&foo=bar"))).toEqual(custom);
  });
});

describe("settings: persistence", () => {
  it("restores the stored settings on reload", () => {
    expect(resolveInitialState(JSON.stringify(custom), "")).toEqual(custom);
  });
  it("the link wins over stored settings", () => {
    const s = resolveInitialState(JSON.stringify(custom), "tilt=10&tab=heatmap");
    expect(s.you.tilt).toBe(10);
    expect(s.tab).toBe("heatmap");
    expect(s.site).toEqual(custom.site);
  });
  it("corrupt or old-format storage falls back field by field", () => {
    expect(resolveInitialState("{not json", "")).toEqual(DEFAULTS);
    const old = JSON.stringify({ site: { lat: 41 }, you: { tilt: 33 } });
    const s = resolveInitialState(old, "");
    expect(s.site).toEqual({ ...DEFAULTS.site, lat: 41 });
    expect(s.you).toEqual({ tilt: 33, azimuth: DEFAULTS.you.azimuth });
  });
  it("sanitize fills a missing object completely", () => {
    expect(sanitize(null)).toEqual(DEFAULTS);
    expect(sanitize("nope")).toEqual(DEFAULTS);
  });
});

describe("settings: share link", () => {
  it("builds a link with every setting and no hash", () => {
    const u = new URL(shareUrl(custom, "https://example.com/sunward/index.html?old=1#debug"));
    expect(u.origin + u.pathname).toBe("https://example.com/sunward/index.html");
    expect(u.hash).toBe("");
    expect(u.searchParams.get("old")).toBeNull();
    expect(mergeState(DEFAULTS, fromQuery(u.search))).toEqual(custom);
  });
});
