import {
  BarController, BarElement, CategoryScale, Chart, Legend, LinearScale, Tooltip,
} from "chart.js";
import { MONTHS } from "../core";

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Legend, Tooltip);

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function baseOptions(yTitle: string, digits: number) {
  const ink = css("--muted"), line = css("--line");
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: false as const,
    interaction: { mode: "index" as const, intersect: false },
    plugins: {
      legend: { position: "top" as const, align: "end" as const, labels: { color: ink, boxWidth: 12, boxHeight: 12, font: { family: css("--font-body") } } },
      tooltip: {
        callbacks: {
          label: (c: { dataset: { label?: string }; parsed: { y: number | null } }) =>
            `${c.dataset.label}: ${(c.parsed.y ?? 0).toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits })} ${yTitle}`,
        },
      },
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: ink }, border: { color: line } },
      y: { grid: { color: line }, ticks: { color: ink }, border: { display: false }, title: { display: true, text: yTitle, color: ink } },
    },
  };
}

export interface MonthlyCharts {
  update(opt: number[], you: number[], unit: string, digits: number, loss: number[]): void;
  retheme(): void;
}

export function createCharts(monthlyCanvas: HTMLCanvasElement, lossCanvas: HTMLCanvasElement): MonthlyCharts {
  let last: Parameters<MonthlyCharts["update"]> | null = null;
  let monthly: Chart<"bar"> | null = null;
  let loss: Chart<"bar"> | null = null;

  const build = () => {
    monthly?.destroy();
    loss?.destroy();
    if (!last) return;
    const [opt, you, unit, digits, lossPct] = last;
    monthly = new Chart(monthlyCanvas, {
      type: "bar",
      data: {
        labels: MONTHS,
        datasets: [
          { label: "Optimal", data: opt, backgroundColor: css("--opt"), borderRadius: 4, borderSkipped: "start", categoryPercentage: 0.7, barPercentage: 0.92 },
          { label: "Yours", data: you, backgroundColor: css("--you"), borderRadius: 4, borderSkipped: "start", categoryPercentage: 0.7, barPercentage: 0.92 },
        ],
      },
      options: baseOptions(unit, digits),
    });
    const lo = baseOptions("%", 1);
    lo.plugins.legend = { ...lo.plugins.legend, display: false } as typeof lo.plugins.legend;
    loss = new Chart(lossCanvas, {
      type: "bar",
      data: { labels: MONTHS, datasets: [{ label: "Loss", data: lossPct, backgroundColor: css("--you"), borderRadius: 4, borderSkipped: "start", categoryPercentage: 0.6 }] },
      options: lo,
    });
  };

  return {
    update(...args) {
      last = args;
      if (!monthly || !loss) return build();
      const [opt, you, unit, digits, lossPct] = args;
      monthly.data.datasets[0].data = opt;
      monthly.data.datasets[1].data = you;
      monthly.options = baseOptions(unit, digits) as typeof monthly.options;
      monthly.update();
      loss.data.datasets[0].data = lossPct;
      loss.update();
    },
    retheme: build,
  };
}
