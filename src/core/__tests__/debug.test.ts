import { traceHour, hourRows, rowsToCsv, pvlibSnippet, HOUR_ROW_COLUMNS } from "../debug";
import { clearSkySource } from "../weather";
import { fixtures, siteOf, params, close, yearFor } from "./helpers";

describe("debug view data", () => {
  it("hour trace reproduces the pvlib sample hour, step by step", async () => {
    const s = fixtures.sites.madrid.samples[5];
    const tr = await traceHour(clearSkySource, siteOf("madrid"), params, { tilt: s.tilt, azimuth: s.surfaceAzimuth }, s.epochMs);
    const v = (k: string) => tr.steps.find((x) => x.key === k)!.value;
    close(v("sun.apparentZenith"), s.apparentZenith, 0, 0.002);
    close(v("etr.dniExtra"), s.dniExtra, 1e-9);
    close(v("clearsky.ghi"), s.ghi, 2e-3, 0.5);
    close(v("poa.direct"), s.poaDirect, 2e-3, 0.5);
    close(v("poa.circumsolar"), s.poaCircumsolar, 2e-3, 0.5);
    close(v("poa.isotropic"), s.poaIsotropic, 2e-3, 0.5);
    close(v("poa.ground"), s.poaGround, 2e-3, 0.05);
    close(v("poa.global"), s.poaGlobal, 2e-3, 0.5);
    expect(v("poa.global")).toBe(tr.poa.global);
  });
  it("every step has a group, label, unit field and a finite value (daytime)", async () => {
    const s = fixtures.sites.oslo.samples[3];
    const tr = await traceHour(clearSkySource, siteOf("oslo"), params, { tilt: 35, azimuth: 180 }, s.epochMs);
    expect(tr.steps.length).toBeGreaterThan(30);
    for (const st of tr.steps) {
      expect(st.group).not.toBe("");
      expect(st.label).not.toBe("");
      expect(Number.isFinite(st.value)).toBe(true);
    }
    const groups = new Set(tr.steps.map((x) => x.group));
    for (const g of ["Inputs", "Time", "Sun position", "Atmosphere", "Top of atmosphere", "Clear sky (Ineichen)"]) expect(groups).toContain(g);
  });
  it("night hour traces a zero result without NaN in the POA", async () => {
    const tr = await traceHour(clearSkySource, siteOf("madrid"), params, { tilt: 35, azimuth: 180 }, Date.UTC(2025, 0, 1, 0, 30));
    expect(tr.poa.global).toBe(0);
  });
  it("day rows match the simulation inputs and sum to the trace totals", async () => {
    const w = await yearFor("madrid");
    const rows = hourRows(w, { tilt: 35, azimuth: 180 }, params, 24 * 171, 24 * 172);
    expect(rows.length).toBe(24);
    expect(rows[12].ghi).toBe(w.ghi[24 * 171 + 12]);
    rows.forEach((r) => close(r.direct + r.circumsolar + r.isotropic + r.ground, r.poa, 1e-12, 1e-12));
  });
  it("CSV has a header and one line per row", async () => {
    const w = await yearFor("madrid");
    const csv = rowsToCsv(hourRows(w, { tilt: 35, azimuth: 180 }, params, 0, 48));
    const lines = csv.split("\n");
    expect(lines.length).toBe(49);
    expect(lines[0].split(",").length).toBe(HOUR_ROW_COLUMNS.length);
    expect(lines[1].startsWith("2025-01-01T00:30:00.000Z")).toBe(true);
  });
  it("pvlib snippet contains the inputs", () => {
    const sn = pvlibSnippet({ lat: 40.4, lon: -3.7, altitude: 667 }, params, { tilt: 35, azimuth: 180 }, Date.UTC(2025, 2, 21, 12, 30));
    expect(sn).toContain("Location(40.4, -3.7");
    expect(sn).toContain('"2025-03-21T12:30:00"');
    expect(sn).toContain('model="haydavies"');
  });
});

describe("debug view with terrain shading", () => {
  const wall = { stepDeg: 5, elevations: new Array(72).fill(30) };
  it("hour trace adds the terrain steps and blocks a low winter sun", async () => {
    const s = fixtures.sites.madrid.samples.find((x) => x.apparentZenith > 62)!; // sun below 28°
    const tr = await traceHour(clearSkySource, siteOf("madrid"), params, { tilt: 35, azimuth: 180 }, s.epochMs, wall);
    const v = (k: string) => tr.steps.find((x) => x.key === k)!.value;
    expect(tr.steps.some((x) => x.group === "Terrain shading")).toBe(true);
    expect(v("shade.visible")).toBe(0);
    expect(v("poa.direct")).toBe(0);
    expect(v("poa.circumsolar")).toBe(0);
    expect(v("poa.global")).toBe(tr.poa.global);
    expect(v("poa.global")).toBeGreaterThan(0); // sky diffuse remains
  });
  it("without a horizon the trace has no terrain steps", async () => {
    const s = fixtures.sites.madrid.samples[5];
    const tr = await traceHour(clearSkySource, siteOf("madrid"), params, { tilt: 35, azimuth: 180 }, s.epochMs, null);
    expect(tr.steps.some((x) => x.key.startsWith("shade."))).toBe(false);
  });
  it("day rows carry the visibility flag and shaded values", async () => {
    const { buildShading } = await import("../shading");
    const w = await yearFor("madrid");
    const sh = buildShading(w, wall);
    const rows = hourRows(w, { tilt: 35, azimuth: 180 }, params, 24 * 354, 24 * 355, sh); // Dec 21
    expect(rows.every((r) => r.sunVisible === 0)).toBe(true); // Dec noon sun ≈ 26° < 30° wall
    expect(rows.every((r) => r.direct === 0)).toBe(true);
    const open = hourRows(w, { tilt: 35, azimuth: 180 }, params, 24 * 354, 24 * 355);
    expect(open.every((r) => r.sunVisible === 1)).toBe(true);
  });
});
