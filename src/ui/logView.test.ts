import { filterEntries, renderEntry } from "./logView";
import type { LogEntry } from "./logStore";

const e = (id: number, level: LogEntry["level"], message = "m"): LogEntry => ({ id, time: Date.UTC(2026, 9, 11, 6, 46, 1, 5), level, source: "t", message });

describe("log view", () => {
  const all = [e(1, "debug"), e(2, "info"), e(3, "warn"), e(4, "error")];
  it("filters by minimum level", () => {
    expect(filterEntries(all, "all").map((x) => x.id)).toEqual([1, 2, 3, 4]);
    expect(filterEntries(all, "warn").map((x) => x.id)).toEqual([3, 4]);
    expect(filterEntries(all, "error").map((x) => x.id)).toEqual([4]);
  });
  it("escapes HTML in messages and details", () => {
    const html = renderEntry({ ...e(9, "error", "<img src=x onerror=alert(1)>"), detail: "<b>x</b>" });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("l-error");
  });
});
