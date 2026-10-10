import { HOUR_ROW_COLUMNS, type HourRow, type TraceStep } from "../core";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function fmtVal(s: TraceStep): string {
  if (s.key === "time.epoch") return "";
  const v = s.value;
  if (!Number.isFinite(v)) return String(v);
  const a = Math.abs(v);
  const d = a === 0 ? 0 : a >= 1000 ? 1 : a >= 100 ? 2 : a >= 1 ? 4 : 6;
  return v.toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: Number.isInteger(v) ? 0 : Math.min(d, 2) });
}

/** Render trace steps grouped, each with formula and substituted numbers. */
export function renderSteps(host: HTMLElement, steps: TraceStep[]) {
  const groups = new Map<string, TraceStep[]>();
  for (const s of steps) {
    if (!groups.has(s.group)) groups.set(s.group, []);
    groups.get(s.group)!.push(s);
  }
  host.innerHTML = [...groups.entries()]
    .map(([g, ss]) => `<div class="step-group"><h4>${esc(g)}</h4>${ss.map(stepHtml).join("")}</div>`)
    .join("");
}

function stepHtml(s: TraceStep): string {
  const formula = s.formula ? `${esc(s.formula)}` : "";
  const sub = s.substituted ? `${formula ? " = " : ""}<b>${esc(s.substituted)}</b>` : "";
  const f = formula || sub ? `<div class="step-f">${formula}${sub}</div>` : "";
  return `<div class="step" data-key="${esc(s.key)}">
    <div class="step-name">${esc(s.label)}${s.symbol ? `<span class="sym">${esc(s.symbol)}</span>` : ""}</div>
    <div class="step-val">${fmtVal(s)}${s.unit && s.key !== "time.epoch" ? `<span class="unit">${esc(s.unit)}</span>` : ""}</div>
    ${f}
  </div>`;
}

/** Day table: one row per hour, all intermediate values. */
export function renderDayTable(table: HTMLTableElement, rows: HourRow[], highlightIndex: number) {
  const head = `<thead><tr>${HOUR_ROW_COLUMNS.map((c) => `<th>${esc(c.label)}${c.unit ? `<br><span style="text-transform:none">${esc(c.unit)}</span>` : ""}</th>`).join("")}</tr></thead>`;
  const body = rows
    .map((r, i) => {
      const cells = HOUR_ROW_COLUMNS.map((c) => {
        if (c.key === "epochMs") return `<td>${new Date(r.epochMs).toISOString().slice(11, 16)}</td>`;
        const v = r[c.key];
        return `<td>${c.key === "cosAoi" ? v.toFixed(3) : c.key === "sunVisible" ? String(v) : v.toFixed(1)}</td>`;
      }).join("");
      const style = i === highlightIndex ? ' style="background:var(--surface-2)"' : "";
      return `<tr class="${r.ghi <= 0 ? "night" : ""}"${style}>${cells}</tr>`;
    })
    .join("");
  const sum = rows.reduce((a, r) => a + r.poa, 0);
  const foot = `<tfoot><tr><td>Day</td><td colspan="${HOUR_ROW_COLUMNS.length - 2}" style="text-align:right">Σ POA × 1 h</td><td>${(sum / 1000).toFixed(3)} kWh/m²</td></tr></tfoot>`;
  table.innerHTML = head + `<tbody>${body}</tbody>` + foot;
}
