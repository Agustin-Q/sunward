import { HOURS_PER_YEAR, hourOfYear } from "../core";
import { fetchNasaPower, nasaCacheKey, nasaPowerUrl } from "./nasaPower";

const answer = (year: number, ghi: number) => {
  const p: Record<string, Record<string, number>> = { ALLSKY_SFC_SW_DWN: {}, ALLSKY_SFC_SW_DNI: {}, ALLSKY_SFC_SW_DIFF: {} };
  p.ALLSKY_SFC_SW_DWN[`${year}062112`] = ghi;
  p.ALLSKY_SFC_SW_DNI[`${year}062112`] = ghi - 100;
  p.ALLSKY_SFC_SW_DIFF[`${year}062112`] = 100;
  return new Response(JSON.stringify({ header: { fill_value: -999 }, properties: { parameter: p } }), { status: 200 });
};

describe("NASA POWER download", () => {
  it("builds the documented hourly point URL (UTC, JSON, RE community, one year)", () => {
    const u = new URL(nasaPowerUrl(38.72019, 0.16496, 2021));
    expect(u.origin + u.pathname).toBe("https://power.larc.nasa.gov/api/temporal/hourly/point");
    expect(u.searchParams.get("parameters")).toBe("ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF");
    expect(u.searchParams.get("time-standard")).toBe("UTC");
    expect(u.searchParams.get("start")).toBe("20210101");
    expect(u.searchParams.get("end")).toBe("20211231");
    expect(u.searchParams.get("latitude")).toBe("38.7202");
  });
  it("fetches each year in sequence, averages them and labels the result", async () => {
    const asked: string[] = [];
    const progress: number[] = [];
    const s = await fetchNasaPower(38.7, 0.16, {
      years: [2022, 2023],
      onProgress: (d) => progress.push(d),
      fetchFn: (async (u: string) => {
        asked.push(new URL(u).searchParams.get("start")!);
        return answer(Number(asked.at(-1)!.slice(0, 4)), asked.length === 1 ? 900 : 700);
      }) as typeof fetch,
    });
    expect(asked).toEqual(["20220101", "20230101"]);
    expect(progress).toEqual([1, 2]);
    expect(s.ghi[hourOfYear(2023, 6, 21, 12)]).toBe(800);
    expect(s.label).toBe("NASA POWER 2022–2023 mean");
    expect(s.missing).toBe(HOURS_PER_YEAR - 1);
  });
  it("explains a blocked request (e.g. CORS) and an HTTP error", async () => {
    await expect(fetchNasaPower(1, 1, { years: [2023], fetchFn: (async () => { throw new TypeError("Failed to fetch"); }) as typeof fetch }))
      .rejects.toThrow(/could not be reached from this browser \(Failed to fetch\)/);
    await expect(fetchNasaPower(1, 1, { years: [2023], fetchFn: (async () => new Response(JSON.stringify({ messages: ["bad"] }), { status: 422 })) as typeof fetch }))
      .rejects.toThrow(/HTTP 422 for 2023: .*bad/);
  });
  it("caches per 0.1° (NASA's solar grid is 1°)", () => {
    expect(nasaCacheKey(38.72019, 0.16496)).toBe(nasaCacheKey(38.71, 0.19));
    expect(nasaCacheKey(38.72, 0.16)).not.toBe(nasaCacheKey(38.92, 0.16));
  });
});
