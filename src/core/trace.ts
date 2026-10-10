/**
 * Calculation tracing. Every core function accepts an optional Tracer and
 * records the intermediate values it actually computed, so the debug view
 * shows the real calculation, not a re-implementation of it.
 */
export interface TraceStep {
  /** Stable machine key, e.g. "clearsky.ghi" */
  key: string;
  /** Group the step belongs to, e.g. "Clear sky (Ineichen)" */
  group: string;
  label: string;
  symbol: string;
  /** Symbolic formula, or "" for inputs / library outputs */
  formula: string;
  /** Formula with the numbers substituted */
  substituted: string;
  value: number;
  unit: string;
}

export interface Tracer {
  add(step: Omit<TraceStep, "group">): void;
  group(name: string): void;
  readonly steps: TraceStep[];
}

export function createTracer(): Tracer {
  const steps: TraceStep[] = [];
  let current = "";
  return {
    steps,
    group(name) {
      current = name;
    },
    add(step) {
      steps.push({ ...step, group: current });
    },
  };
}

/** Format a number for formula substitution. */
export function fmt(x: number, digits = 4): string {
  if (!Number.isFinite(x)) return String(x);
  if (x === 0) return "0";
  const a = Math.abs(x);
  if (a >= 1e5 || a < 1e-3) return x.toExponential(3);
  return Number(x.toFixed(digits)).toString();
}

/** Look up a traced value by key (throws if missing — useful in tests). */
export function traced(t: Tracer, key: string): number {
  const s = t.steps.find((x) => x.key === key);
  if (!s) throw new Error(`trace key not found: ${key}`);
  return s.value;
}
