import { chunk, elevationUrl, openMeteoSampler } from "./elevation";

const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ lat: 40 + i * 1e-3, lon: -3.7 }));
const okResponse = (url: string) => {
  const n = new URL(url).searchParams.get("latitude")!.split(",").length;
  return new Response(JSON.stringify({ elevation: Array.from({ length: n }, (_, i) => 600 + i) }), { status: 200 });
};

describe("Open-Meteo elevation sampler", () => {
  it("splits into chunks of 100", () => {
    expect(chunk(pts(250), 100).map((c) => c.length)).toEqual([100, 100, 50]);
  });
  it("builds a multi-coordinate URL with 5 decimals", () => {
    const u = new URL(elevationUrl([{ lat: 40.123456, lon: -3.7 }, { lat: 41, lon: 2.1 }]));
    expect(u.searchParams.get("latitude")).toBe("40.12346,41.00000");
    expect(u.searchParams.get("longitude")).toBe("-3.70000,2.10000");
  });
  it("returns elevations in input order across batches and reports progress", async () => {
    const calls: string[] = [];
    const progress: number[] = [];
    const s = openMeteoSampler({ fetchFn: (async (u: string) => { calls.push(u); return okResponse(u); }) as typeof fetch, onProgress: (d) => progress.push(d) });
    const z = await s(pts(1729));
    expect(z.length).toBe(1729);
    expect(calls.length).toBe(18);
    expect(z[0]).toBe(600);
    expect(z[100]).toBe(600); // first of the second batch
    expect(z[1728]).toBe(600 + 28);
    expect(progress.sort((a, b) => a - b)).toEqual(Array.from({ length: 18 }, (_, i) => i + 1));
  });
  it("retries a rate-limited request, then succeeds", async () => {
    let n = 0;
    const s = openMeteoSampler({ retryDelayMs: 1, fetchFn: (async (u: string) => (n++ === 0 ? new Response("", { status: 429 }) : okResponse(u))) as typeof fetch });
    expect((await s(pts(3))).length).toBe(3);
    expect(n).toBe(2);
  });
  it("fails clearly on a client error or a malformed answer", async () => {
    const bad = openMeteoSampler({ fetchFn: (async () => new Response("", { status: 400 })) as typeof fetch });
    await expect(bad(pts(3))).rejects.toThrow(/error 400/);
    const weird = openMeteoSampler({ fetchFn: (async () => new Response(JSON.stringify({ elevation: [1] }), { status: 200 })) as typeof fetch });
    await expect(weird(pts(3))).rejects.toThrow(/unexpected/);
  });
});
