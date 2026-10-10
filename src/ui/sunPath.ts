import { horizonAt, type HorizonProfile, type Site } from "../core";
import { compassPoint } from "./helpers";
import { splitByHorizon, sunPaths, type SunPath } from "./sunPathData";

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const W = 760, H = 330, PAD = { l: 40, r: 14, t: 14, b: 36 };

export interface SunPathChart {
  draw(site: Site, profile: HorizonProfile | null): void;
  redraw(): void;
}

/**
 * Sun-path chart: azimuth (x, centred on the equator-facing direction) ×
 * elevation (y). Paths for the 21st of each month; parts behind the
 * terrain skyline are dashed. The skyline is filled.
 */
export function createSunPathChart(canvas: HTMLCanvasElement, tip: HTMLElement): SunPathChart {
  let state: { site: Site; profile: HorizonProfile | null; paths: SunPath[]; key: string } | null = null;

  const geom = () => {
    const start = state!.site.lat >= 0 ? 0 : 180; // x runs N→E→S→W→N (or S→W→N→E→S)
    const maxEl = Math.min(90, Math.ceil((Math.max(...state!.paths[0].points.map((p) => p.elevation), ...state!.paths[6].points.map((p) => p.elevation), 30) + 5) / 10) * 10);
    const pw = W - PAD.l - PAD.r, ph = H - PAD.t - PAD.b;
    const xOf = (az: number) => PAD.l + ((((az - start) % 360) + 360) % 360) / 360 * pw;
    const yOf = (el: number) => PAD.t + ph - (Math.max(0, el) / maxEl) * ph;
    return { start, maxEl, pw, ph, xOf, yOf };
  };

  const render = () => {
    if (!state) return;
    const g = geom();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ink = css("--muted"), line = css("--line"), sun = css("--opt"), terrain = css("--terrain");

    // grid
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.font = `11px ${css("--font-mono")}`;
    ctx.fillStyle = ink;
    ctx.textAlign = "right";
    for (let e = 0; e <= g.maxEl; e += 10) {
      const y = g.yOf(e);
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(W - PAD.r, y); ctx.stroke();
      ctx.fillText(`${e}°`, PAD.l - 6, y + 4);
    }
    ctx.textAlign = "center";
    for (let k = 0; k <= 8; k++) {
      const az = (g.start + k * 45) % 360;
      const x = PAD.l + (k / 8) * g.pw;
      ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, H - PAD.b); ctx.stroke();
      ctx.fillText(`${az}°`, x, H - PAD.b + 14);
      ctx.fillText(compassPoint(az), x, H - PAD.b + 27);
    }

    // terrain skyline
    if (state.profile) {
      ctx.beginPath();
      ctx.moveTo(PAD.l, g.yOf(0));
      for (let k = 0; k <= 360; k += 1) {
        const az = (g.start + k) % 360;
        ctx.lineTo(PAD.l + (k / 360) * g.pw, g.yOf(Math.min(g.maxEl, horizonAt(state.profile, az))));
      }
      ctx.lineTo(W - PAD.r, g.yOf(0));
      ctx.closePath();
      ctx.fillStyle = terrain;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // sun paths
    for (const [i, path] of state.paths.entries()) {
      const bold = i === 0 || i === state.paths.length - 1;
      for (const run of splitByHorizon(path, state.profile)) {
        ctx.beginPath();
        run.points.forEach((p, j) => {
          const x = g.xOf(p.azimuth), y = g.yOf(p.elevation);
          // avoid drawing a line across the chart when azimuth wraps
          if (j > 0 && Math.abs(x - g.xOf(run.points[j - 1].azimuth)) > g.pw / 2) ctx.moveTo(x, y);
          else if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
        ctx.strokeStyle = run.visible ? sun : ink;
        ctx.globalAlpha = run.visible ? 1 : 0.55;
        ctx.lineWidth = bold ? 2.5 : 1.5;
        ctx.setLineDash(run.visible ? [] : [4, 4]);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      // hour marks
      for (const h of path.hours) {
        ctx.beginPath();
        ctx.arc(g.xOf(h.azimuth), g.yOf(h.elevation), bold ? 3 : 2.2, 0, Math.PI * 2);
        ctx.fillStyle = state.profile && h.elevation <= horizonAt(state.profile, h.azimuth) ? ink : sun;
        ctx.fill();
      }
      // label on the afternoon side (45° past the equator-facing direction), where paths are spread apart
      const labelAz = (state.site.lat >= 0 ? 180 : 0) + 45;
      const at = path.points.reduce((a, b) => (Math.abs(((b.azimuth - labelAz + 540) % 360) - 180) < Math.abs(((a.azimuth - labelAz + 540) % 360) - 180) ? b : a), path.points[0]);
      if (at) {
        ctx.fillStyle = css("--ink");
        ctx.font = `${bold ? 600 : 400} 11px ${css("--font-body")}`;
        ctx.textAlign = "left";
        ctx.fillText(path.label, g.xOf(at.azimuth) + 7, g.yOf(at.elevation) + 4);
      }
    }
    // hour labels along the highest path
    ctx.fillStyle = ink;
    ctx.font = `10px ${css("--font-mono")}`;
    ctx.textAlign = "center";
    const high = state.site.lat >= 0 ? state.paths[0] : state.paths[state.paths.length - 1];
    const labelAz = (state.site.lat >= 0 ? 180 : 0) + 45;
    for (const h of high.hours) {
      const nearMonthLabels = Math.abs(((h.azimuth - labelAz + 540) % 360) - 180) < 30;
      if (h.hour % 2 === 0 && !nearMonthLabels) ctx.fillText(`${h.hour}h`, g.xOf(h.azimuth), g.yOf(h.elevation) - 7);
    }
  };

  canvas.addEventListener("pointermove", (e) => {
    if (!state) return;
    const g = geom();
    const r = canvas.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W, y = ((e.clientY - r.top) / r.height) * H;
    if (x < PAD.l || x > W - PAD.r || y < PAD.t || y > H - PAD.b) return void (tip.hidden = true);
    const az = Math.round((g.start + ((x - PAD.l) / g.pw) * 360) % 360);
    const el = ((PAD.t + g.ph - y) / g.ph) * g.maxEl;
    const hz = state.profile ? ` · skyline ${horizonAt(state.profile, az).toFixed(1)}°` : "";
    tip.textContent = `${az}° ${compassPoint(az)}, ${el.toFixed(0)}° up${hz}`;
    tip.hidden = false;
    const host = ((tip.offsetParent as HTMLElement | null) ?? canvas.parentElement!).getBoundingClientRect();
    tip.style.left = `${Math.max(4, Math.min(e.clientX - host.left + 12, host.width - tip.offsetWidth - 4))}px`;
    tip.style.top = `${e.clientY - host.top + 16}px`;
  });
  canvas.addEventListener("pointerleave", () => (tip.hidden = true));

  return {
    draw(site, profile) {
      const key = `${site.lat.toFixed(4)},${site.lon.toFixed(4)},${site.altitude}`;
      const paths = state?.key === key ? state.paths : sunPaths(site);
      state = { site, profile, paths, key };
      render();
    },
    redraw: render,
  };
}
