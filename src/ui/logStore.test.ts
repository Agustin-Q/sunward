import { captureConsole, createLogStore, formatArgs, formatValue, stackOf } from "./logStore";

describe("log store", () => {
  it("records entries with id, time, level and source", () => {
    let t = 1000;
    const s = createLogStore(10, () => t++);
    const e = s.add("warn", "app", "hello", "detail");
    expect(e).toEqual({ id: 1, time: 1000, level: "warn", source: "app", message: "hello", detail: "detail" });
    expect(s.entries()).toHaveLength(1);
    expect(s.counts()).toEqual({ debug: 0, info: 0, warn: 1, error: 0 });
  });
  it("keeps only the newest entries (ring buffer)", () => {
    const s = createLogStore(3);
    for (let i = 0; i < 5; i++) s.add("info", "t", `m${i}`);
    expect(s.entries().map((e) => e.message)).toEqual(["m2", "m3", "m4"]);
    expect(s.entries()[0].id).toBe(3);
  });
  it("notifies subscribers, survives a throwing listener, and can unsubscribe", () => {
    const s = createLogStore();
    const seen: (string | null)[] = [];
    s.subscribe(() => { throw new Error("bad listener"); });
    const off = s.subscribe((e) => seen.push(e ? e.message : null));
    s.add("info", "t", "a");
    s.clear();
    off();
    s.add("info", "t", "b");
    expect(seen).toEqual(["a", null]);
    expect(s.entries().map((e) => e.message)).toEqual(["b"]);
  });
  it("exports readable text with indented detail", () => {
    const s = createLogStore(10, () => Date.UTC(2026, 9, 11, 8, 46));
    s.add("error", "uncaught", "Boom", "at a\nat b");
    expect(s.toText()).toBe("2026-10-11T08:46:00.000Z ERROR [uncaught] Boom\n    at a\n    at b");
  });
});

describe("formatting values", () => {
  it("formats errors, primitives, objects, typed arrays and cycles", () => {
    expect(formatValue(new RangeError("bad"))).toBe("RangeError: bad");
    expect(formatValue(undefined)).toBe("undefined");
    expect(formatValue(null)).toBe("null");
    expect(formatValue(3n)).toBe("3n");
    expect(formatValue({ a: 1, b: [2] })).toBe('{"a":1,"b":[2]}');
    expect(formatValue({ arr: new Float64Array(8760) })).toBe('{"arr":"[Float64Array × 8760]"}');
    const cyc: Record<string, unknown> = { x: 1 };
    cyc.self = cyc;
    expect(formatValue(cyc)).toBe('{"x":1,"self":"[circular]"}');
    expect(formatValue(function named() {})).toBe("[function named]");
  });
  it("joins arguments, truncates very long text and finds a stack", () => {
    expect(formatArgs(["a", 1, { b: 2 }])).toBe('a 1 {"b":2}');
    expect(formatArgs(["x".repeat(5000)]).length).toBeLessThan(4100);
    const err = new Error("e");
    expect(stackOf(["msg", err])).toBe(err.stack);
    expect(stackOf(["msg"])).toBeUndefined();
  });
});

describe("console capture", () => {
  it("mirrors console calls into the store, keeps the original output, and restores", () => {
    const out: string[] = [];
    const fake = {
      log: (...a: unknown[]) => out.push(`log ${a.join(" ")}`),
      info: (...a: unknown[]) => out.push(`info ${a.join(" ")}`),
      debug: (...a: unknown[]) => out.push(`debug ${a.join(" ")}`),
      warn: (...a: unknown[]) => out.push(`warn ${a.join(" ")}`),
      error: (...a: unknown[]) => out.push(`error ${a.join(" ")}`),
    };
    const s = createLogStore();
    const restore = captureConsole(s, fake as unknown as Console);
    fake.log("hello", 1);
    fake.warn("careful");
    fake.error(new Error("boom"));
    expect(out).toEqual(["log hello 1", "warn careful", "error Error: boom"]);
    expect(s.entries().map((e) => [e.level, e.message])).toEqual([["info", "hello 1"], ["warn", "careful"], ["error", "Error: boom"]]);
    expect(s.entries()[2].detail).toContain("boom");
    restore();
    fake.log("after");
    expect(s.entries()).toHaveLength(3);
  });
});
