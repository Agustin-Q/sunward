import { test as base, expect, type Page } from "@playwright/test";

export const APP = new URL("../dist/index.html", import.meta.url).href;

/** Console noise that is expected when outside hosts are blocked in tests. */
const IGNORED = [/Failed to load resource/i, /net::ERR_/i];

export interface Problems {
  pageErrors: string[];
  consoleErrors: string[];
}

/**
 * Every test gets a page that:
 * - blocks external network (map tiles, fonts, geocoding) unless a test routes it
 * - records uncaught page errors and console.error calls
 * and fails the test afterwards if any were recorded.
 */
export const test = base.extend<{ problems: Problems }>({
  problems: async ({ page }, use) => {
    const problems: Problems = { pageErrors: [], consoleErrors: [] };
    page.on("pageerror", (e) => problems.pageErrors.push(String(e)));
    page.on("console", (m) => {
      if (m.type() === "error" && !IGNORED.some((r) => r.test(m.text()))) problems.consoleErrors.push(m.text());
    });
    await page.route(/^https?:\/\//, (r) => r.abort());
    await use(problems);
    expect(problems.pageErrors, "uncaught errors in the page").toEqual([]);
    expect(problems.consoleErrors, "console errors").toEqual([]);
  },
});
export { expect };

/** Open the app with settings in the query string and wait for the first result. */
export async function openAt(page: Page, query: string) {
  await page.goto(`${APP}?${query}`);
  await expect(page.locator("#s-opt")).not.toHaveText("–", { timeout: 30_000 });
}

/** The app's own error surfaces must be clean. */
export async function expectNoAppErrors(page: Page) {
  await expect(page.locator("#loc-msg")).not.toHaveText(/failed/i);
  await expect(page.locator("#log-badge")).toBeHidden();
}
