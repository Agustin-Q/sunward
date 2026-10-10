import type { Heatmap, Orientation } from "../core";
import { RAMP_STOPS, compassPoint, heatScale, rampColor } from "./helpers";

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const PAD = { l: 44, r: 12, t: 12, b: 36 };

export interface HeatmapView {
  draw(h: Heatmap, best: number, you: Orientation, opt: Orientation): void;
  redraw(): void;
}

/** Canvas heatmap: x = azimuth, y = tilt (0 at the bottom), colour = % of best. */
export function createHeatmap(canvas: HTMLCanvasElement, tip: HTMLElement, legend: HTMLElement, onPick: (o: Orientation) => void): HeatmapView {
  let state: { h: Heatmap; best: number; you: Orientation; opt: Orientation } | null = null;
  const W = 760, H = 380;

  const geom = () => {
    if (!state) return null;
    const { h } = state;
    const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
    const cw = pw / h.azimuths.length, ch = ph / h.tilts.length;
    const azStep = h.azimuths[1] - h.azimuths[0];
    const tStep = h.tilts[1] - h.tilts[0];
    // azimuth a maps to centre of its column; tilt t to centre of its row (0 at bottom)
    const xOf = (az: number) => PAD.l + ((((az % 360) + 360) % 360) / azStep + 0.5) * cw;
    const yOf = (t: number) => PAD.t + ph - (t / tStep + 0.5) * ch;
    return { pw, ph, cw, ch, azStep, tStep, xOf, yOf };
  };

  const render = () => {
    const g = geom();
    if (!state || !g) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const { h, best, you, opt } = state;
    h.tilts.forEach((t, i) => {
      h.azimuths.forEach((_, j) => {
        const pct = (h.values[i][j] / best) * 100;
        ctx.fillStyle = rampColor(heatScale(pct));
        const x = PAD.l + j * g.cw, y = PAD.t + g.ph - (i + 1) * g.ch;
        ctx.fillRect(x + 0.5, y + 0.5, g.cw - 1, g.ch - 1);
      });
    });
    const ink = css("--muted");
    ctx.fillStyle = ink;
    ctx.font = `11px ${css("--font-mono")}`;
    ctx.textAlign = "center";
    for (const az of [0, 45, 90, 135, 180, 225, 270, 315]) {
      const x = g.xOf(az);
      ctx.fillText(`${az}°`, x, H - PAD.b + 14);
      ctx.fillText(compassPoint(az), x, H - PAD.b + 27);
    }
    ctx.textAlign = "right";
    for (const t of [0, 15, 30, 45, 60, 75, 90]) ctx.fillText(`${t}°`, PAD.l - 6, g.yOf(t) + 4);
    ctx.save();
    ctx.translate(11, PAD.t + g.ph / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText("tilt", 0, 0);
    ctx.restore();

    const mark = (o: Orientation, fill: string, stroke: string) => {
      const x = g.xOf(o.azimuth), y = PAD.t + g.ph - (o.tilt / g.tStep + 0.5) * g.ch;
      ctx.beginPath();
      ctx.arc(x, y, 7, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = stroke;
      ctx.stroke();
    };
    mark(opt, css("--opt"), "#ffffff");
    mark(you, "#ffffff", css("--you"));

    legend.innerHTML = `<span>≤60%</span><span class="bar" style="background:linear-gradient(90deg,${RAMP_STOPS.join(",")})"></span><span>100%</span>
      <span style="display:inline-flex;gap:6px;align-items:center;margin-left:10px"><span class="key key-opt" style="width:10px;height:10px;border-radius:50%"></span>Optimal <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#fff;border:3px solid var(--you)"></span>Yours</span>`;
  };

  const cellAt = (e: MouseEvent | PointerEvent) => {
    const g = geom();
    if (!state || !g) return null;
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    const j = Math.floor((x - PAD.l) / g.cw), i = Math.floor((PAD.t + g.ph - y) / g.ch);
    if (i < 0 || j < 0 || i >= state.h.tilts.length || j >= state.h.azimuths.length) return null;
    return { i, j, px: e.clientX - r.left, py: e.clientY - r.top };
  };

  canvas.addEventListener("pointermove", (e) => {
    const c = cellAt(e);
    if (!c || !state) return void (tip.hidden = true);
    const t = state.h.tilts[c.i], az = state.h.azimuths[c.j];
    const v = state.h.values[c.i][c.j];
    tip.textContent = `tilt ${t}°, ${az}° ${compassPoint(az)}: ${v.toFixed(0)} kWh/m² (${((v / state.best) * 100).toFixed(1)}%)`;
    tip.hidden = false;
    const host = ((tip.offsetParent as HTMLElement | null) ?? canvas.parentElement!).getBoundingClientRect();
    const cr = canvas.getBoundingClientRect();
    tip.style.left = `${Math.max(4, Math.min(cr.left - host.left + c.px + 12, host.width - tip.offsetWidth - 4))}px`;
    tip.style.top = `${cr.top - host.top + c.py + 16}px`;
  });
  canvas.addEventListener("pointerleave", () => (tip.hidden = true));
  canvas.addEventListener("click", (e) => {
    const c = cellAt(e);
    if (c && state) onPick({ tilt: state.h.tilts[c.i], azimuth: state.h.azimuths[c.j] });
  });

  return {
    draw(h, best, you, opt) {
      state = { h, best, you, opt };
      render();
    },
    redraw: render,
  };
}
