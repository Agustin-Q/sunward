import { appLog, type LogEntry, type LogLevel, type LogStore } from "./logStore";

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/** Which entries a filter value shows: "all", "warn" (warn + error) or "error". */
export function filterEntries(entries: LogEntry[], filter: string): LogEntry[] {
  const min = filter === "error" ? 3 : filter === "warn" ? 2 : 0;
  return entries.filter((e) => RANK[e.level] >= min);
}

export function renderEntry(e: LogEntry): string {
  const t = new Date(e.time);
  const time = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}.${String(t.getMilliseconds()).padStart(3, "0")}`;
  const detail = e.detail ? `<details><summary>Details</summary><pre>${esc(e.detail)}</pre></details>` : "";
  return `<div class="log-row l-${e.level}"><span class="log-time">${time}</span><span class="log-level">${e.level}</span><span class="log-msg"><span class="log-src">[${esc(e.source)}]</span> ${esc(e.message)}</span>${detail}</div>`;
}

/** Live log list in the Debug tab, plus an error badge on the tab. */
export function createLogView(
  list: HTMLElement, filterEl: HTMLSelectElement, copyBtn: HTMLButtonElement, clearBtn: HTMLButtonElement,
  summary: HTMLElement, copyMsg: HTMLElement, badge: HTMLElement, store: LogStore = appLog,
) {
  const render = () => {
    const shown = filterEntries(store.entries(), filterEl.value);
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 30;
    list.innerHTML = shown.map(renderEntry).join("");
    if (atBottom) list.scrollTop = list.scrollHeight;
    const c = store.counts();
    summary.textContent = `${c.error} error${c.error === 1 ? "" : "s"}, ${c.warn} warning${c.warn === 1 ? "" : "s"}, ${c.info + c.debug} messages`;
    badge.hidden = c.error === 0;
    badge.textContent = String(c.error);
    badge.setAttribute("aria-label", `${c.error} errors in the log`);
  };
  let pending = false;
  store.subscribe(() => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => { pending = false; render(); });
  });
  filterEl.addEventListener("change", render);
  clearBtn.addEventListener("click", () => store.clear());
  copyBtn.addEventListener("click", async () => {
    const ver = document.getElementById("build-stamp")?.textContent ?? "";
    const text = `Sunward log (version ${ver})\n${location.href}\n${navigator.userAgent}\n\n${store.toText()}`;
    try {
      await navigator.clipboard.writeText(text);
      copyMsg.textContent = "Copied. Paste it into a message to report a problem.";
    } catch {
      const r = document.createRange();
      r.selectNodeContents(list);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(r);
      copyMsg.textContent = "Copying is blocked here. The log is selected; copy it by hand.";
    }
  });
  render();
}
