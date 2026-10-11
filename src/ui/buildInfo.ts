/** Build stamp injected by vite.config.ts from git at build time. */
declare const __BUILD_COMMIT__: string;
declare const __BUILD_COMMIT_DATE__: string;

export interface BuildInfo {
  /** Short commit hash, or "dev" when built outside git */
  commit: string;
  /** Commit date, ISO 8601, or "" */
  date: string;
}

export const BUILD: BuildInfo = {
  commit: typeof __BUILD_COMMIT__ === "string" ? __BUILD_COMMIT__ : "dev",
  date: typeof __BUILD_COMMIT_DATE__ === "string" ? __BUILD_COMMIT_DATE__ : "",
};

/** "a1b2c3d · 11 Oct 2026, 08:54" in the viewer's time zone. */
export function formatBuild(b: BuildInfo, locale = "en-GB", timeZone?: string): string {
  if (!b.date) return b.commit;
  const d = new Date(b.date);
  if (Number.isNaN(d.getTime())) return b.commit;
  const when = d.toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, ...(timeZone ? { timeZone } : {}) });
  return `${b.commit} · ${when}`;
}

export const REPO_URL = "https://github.com/Agustin-Q/sunward";
export const commitUrl = (b: BuildInfo) => (/^[0-9a-f]{7,}$/.test(b.commit) ? `${REPO_URL}/commit/${b.commit}` : REPO_URL);
