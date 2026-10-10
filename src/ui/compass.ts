import { compassPoint, pointerAzimuth } from "./helpers";

const NS = "http://www.w3.org/2000/svg";

export interface Compass {
  update(you: number, opt: number | null): void;
}

/** SVG compass dial. Drag or use arrow keys to set the "yours" azimuth. */
export function createCompass(svg: SVGSVGElement, onChange: (az: number) => void): Compass {
  let you = 180;
  svg.innerHTML = "";
  const el = (tag: string, attrs: Record<string, string | number>, parent: Element = svg) => {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    parent.appendChild(e);
    return e;
  };
  el("circle", { r: 100, fill: "var(--surface-2)", stroke: "var(--line)", "stroke-width": 1.5 });
  for (let a = 0; a < 360; a += 15) {
    const major = a % 90 === 0;
    const r1 = major ? 84 : a % 45 === 0 ? 88 : 92;
    const s = Math.sin((a * Math.PI) / 180), c = -Math.cos((a * Math.PI) / 180);
    el("line", { x1: s * r1, y1: c * r1, x2: s * 99, y2: c * 99, stroke: "var(--muted)", "stroke-width": major ? 2 : 1 });
  }
  for (const [lab, a] of [["N", 0], ["E", 90], ["S", 180], ["W", 270]] as const) {
    const s = Math.sin((a * Math.PI) / 180), c = -Math.cos((a * Math.PI) / 180);
    const t = el("text", { x: s * 70, y: c * 70 + 5, "text-anchor": "middle", fill: lab === "N" ? "var(--accent)" : "var(--ink)", "font-family": "var(--font-display)", "font-weight": 800, "font-size": 16 });
    t.textContent = lab;
  }
  const arrow = (color: string, dashed: boolean) => {
    const g = el("g", {});
    el("line", { x1: 0, y1: 0, x2: 0, y2: -62, stroke: color, "stroke-width": 4, "stroke-linecap": "round", "stroke-dasharray": dashed ? "6 5" : "" }, g);
    el("path", { d: "M0 -80 L-9 -60 L9 -60 Z", fill: color }, g);
    return g;
  };
  const optArrow = arrow("var(--opt)", true);
  const youArrow = arrow("var(--you)", false);
  el("circle", { r: 6, fill: "var(--ink)" });

  const update = (y: number, o: number | null) => {
    you = y;
    youArrow.setAttribute("transform", `rotate(${y})`);
    optArrow.setAttribute("visibility", o === null ? "hidden" : "visible");
    if (o !== null) optArrow.setAttribute("transform", `rotate(${o})`);
    svg.setAttribute("aria-valuenow", String(Math.round(y)));
    svg.setAttribute("aria-valuetext", `${Math.round(y)} degrees, ${compassPoint(y)}`);
  };

  let dragging = false;
  const fromEvent = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    return Math.round(pointerAzimuth(r.left + r.width / 2, r.top + r.height / 2, e.clientX, e.clientY));
  };
  svg.addEventListener("pointerdown", (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    onChange(fromEvent(e));
  });
  svg.addEventListener("pointermove", (e) => dragging && onChange(fromEvent(e)));
  svg.addEventListener("pointerup", () => (dragging = false));
  svg.addEventListener("pointercancel", () => (dragging = false));
  svg.addEventListener("keydown", (e) => {
    const step = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") onChange((you + step) % 360);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") onChange((you - step + 360) % 360);
    else return;
    e.preventDefault();
  });
  return { update };
}

/** Side view of the panel tilt (yours solid, optimal dashed). */
export function renderTiltView(svg: SVGSVGElement, you: number, opt: number | null) {
  const len = 70, x0 = 40, y0 = 60;
  const end = (t: number) => [x0 + len * Math.cos((t * Math.PI) / 180), y0 - len * Math.sin((t * Math.PI) / 180)];
  const [yx, yy] = end(you);
  const optLine = opt === null ? "" : (() => {
    const [ox, oy] = end(opt);
    return `<line x1="${x0}" y1="${y0}" x2="${ox}" y2="${oy}" stroke="var(--opt)" stroke-width="3" stroke-dasharray="5 4" stroke-linecap="round"/>`;
  })();
  svg.innerHTML = `
    <line x1="4" y1="${y0}" x2="156" y2="${y0}" stroke="var(--muted)" stroke-width="1.5"/>
    ${optLine}
    <line x1="${x0}" y1="${y0}" x2="${yx}" y2="${yy}" stroke="var(--you)" stroke-width="5" stroke-linecap="round"/>
    <path d="M${x0 + 22} ${y0} A22 22 0 0 0 ${x0 + 22 * Math.cos((you * Math.PI) / 180)} ${y0 - 22 * Math.sin((you * Math.PI) / 180)}" fill="none" stroke="var(--you)" stroke-width="1.2"/>
    <text x="150" y="${y0 - 6}" text-anchor="end" font-family="var(--font-mono)" font-size="10" fill="var(--muted)">ground</text>`;
}
