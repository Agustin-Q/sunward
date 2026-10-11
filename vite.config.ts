import { defineConfig } from "vitest/config";
import { viteSingleFile } from "vite-plugin-singlefile";
import { execSync } from "node:child_process";

/** Short hash and commit date of HEAD, shown in the app so you can tell which version is live. */
function git(cmd: string, fallback: string): string {
  try { return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || fallback; } catch { return fallback; }
}
const commit = git("rev-parse --short=7 HEAD", "dev");
const commitDate = git("log -1 --format=%cI", "");

export default defineConfig({
  plugins: [viteSingleFile()],
  define: {
    __BUILD_COMMIT__: JSON.stringify(commit),
    __BUILD_COMMIT_DATE__: JSON.stringify(commitDate),
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    // A stray .only must never hide other tests (e.g. the mandatory integration sites).
    allowOnly: false,
    coverage: { include: ["src/core/**"] },
  },
});
