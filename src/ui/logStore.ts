/**
 * In-page log: captures console output, uncaught errors, unhandled promise
 * rejections and app events into a bounded ring buffer, so problems can be
 * seen on a phone without developer tools (Debug → Log).
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  /** Where it came from: console, window.onerror, promise, worker, app … */
  source: string;
  message: string;
  /** Stack trace or extra detail, if any */
  detail?: string;
}

export interface LogStore {
  add(level: LogLevel, source: string, message: string, detail?: string): LogEntry;
  entries(): LogEntry[];
  counts(): Record<LogLevel, number>;
  clear(): void;
  subscribe(fn: (e: LogEntry | null) => void): () => void;
  /** Plain-text export for copying into a bug report */
  toText(): string;
}

export const MAX_ENTRIES = 500;
const MAX_TEXT = 4000;

/** Turn any console argument or thrown value into readable text. */
export function formatValue(v: unknown, seen = new WeakSet<object>()): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "string") return v;
  if (v === undefined) return "undefined";
  if (typeof v === "function") return `[function ${v.name || "anonymous"}]`;
  if (typeof v === "bigint") return `${v}n`;
  if (v === null || typeof v !== "object") return String(v);
  if (typeof Element !== "undefined" && v instanceof Element) return `<${v.tagName.toLowerCase()}${v.id ? `#${v.id}` : ""}>`;
  try {
    return JSON.stringify(v, (_k, x) => {
      if (x && typeof x === "object") {
        if (seen.has(x)) return "[circular]";
        seen.add(x);
        if (ArrayBuffer.isView(x) && !(x instanceof DataView)) return `[${x.constructor.name} × ${(x as unknown as { length: number }).length}]`;
      }
      if (x instanceof Error) return `${x.name}: ${x.message}`;
      return x;
    });
  } catch {
    return Object.prototype.toString.call(v);
  }
}

export function formatArgs(args: unknown[]): string {
  const s = args.map((a) => formatValue(a)).join(" ");
  return s.length > MAX_TEXT ? s.slice(0, MAX_TEXT) + " …" : s;
}

/** First stack found among the arguments, if any. */
export function stackOf(args: unknown[]): string | undefined {
  for (const a of args) if (a instanceof Error && a.stack) return a.stack;
  return undefined;
}

export function createLogStore(max = MAX_ENTRIES, now: () => number = Date.now): LogStore {
  let buf: LogEntry[] = [];
  let nextId = 1;
  const subs = new Set<(e: LogEntry | null) => void>();
  const store: LogStore = {
    add(level, source, message, detail) {
      const e: LogEntry = { id: nextId++, time: now(), level, source, message, ...(detail ? { detail } : {}) };
      buf.push(e);
      if (buf.length > max) buf = buf.slice(buf.length - max);
      subs.forEach((fn) => { try { fn(e); } catch { /* a broken listener must not break logging */ } });
      return e;
    },
    entries: () => buf.slice(),
    counts() {
      const c: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
      for (const e of buf) c[e.level]++;
      return c;
    },
    clear() {
      buf = [];
      subs.forEach((fn) => { try { fn(null); } catch { /* ignore */ } });
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    toText() {
      return buf
        .map((e) => `${new Date(e.time).toISOString()} ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.message}${e.detail ? `\n    ${e.detail.replace(/\n/g, "\n    ")}` : ""}`)
        .join("\n");
    },
  };
  return store;
}

type ConsoleLike = Pick<Console, "log" | "info" | "warn" | "error" | "debug">;
const LEVEL_OF: Record<keyof ConsoleLike, LogLevel> = { log: "info", info: "info", debug: "debug", warn: "warn", error: "error" };

/**
 * Mirror console calls into the store. The original console still works.
 * Returns a function that restores the original methods.
 */
export function captureConsole(store: LogStore, target: ConsoleLike = console): () => void {
  const originals: Partial<ConsoleLike> = {};
  for (const k of Object.keys(LEVEL_OF) as (keyof ConsoleLike)[]) {
    const orig = target[k].bind(target);
    originals[k] = target[k];
    target[k] = (...args: unknown[]) => {
      try { store.add(LEVEL_OF[k], "console", formatArgs(args), stackOf(args)); } catch { /* never break the console */ }
      orig(...args);
    };
  }
  return () => { for (const k of Object.keys(originals) as (keyof ConsoleLike)[]) target[k] = originals[k]!; };
}

/** Capture uncaught errors and unhandled promise rejections. */
export function captureGlobalErrors(store: LogStore, w: Window = window): () => void {
  const onError = (ev: ErrorEvent) => {
    const where = ev.filename ? ` (${ev.filename.split("/").pop()}:${ev.lineno}:${ev.colno})` : "";
    store.add("error", "uncaught", `${ev.message || formatValue(ev.error)}${where}`, ev.error instanceof Error ? ev.error.stack : undefined);
  };
  const onRejection = (ev: PromiseRejectionEvent) => {
    store.add("error", "promise", `Unhandled rejection: ${formatValue(ev.reason)}`, ev.reason instanceof Error ? ev.reason.stack : undefined);
  };
  w.addEventListener("error", onError);
  w.addEventListener("unhandledrejection", onRejection);
  return () => {
    w.removeEventListener("error", onError);
    w.removeEventListener("unhandledrejection", onRejection);
  };
}

/** The app-wide log (created once, before anything else runs). */
export const appLog = createLogStore();
