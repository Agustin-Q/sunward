import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests against the built single-file app (dist/index.html).
 * Run: npm run build && npm run test:e2e
 * External network is blocked in the tests (see e2e/fixtures.ts) so they are deterministic.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  use: { trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
});
