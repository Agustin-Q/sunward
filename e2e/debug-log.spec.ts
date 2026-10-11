import { test, expect, openAt, expectNoAppErrors } from "./fixtures";

test("Debug → Log shows app messages and captured errors", async ({ page, problems }) => {
  await openAt(page, "lat=38.71729&lon=0.16168&alt=320&tab=debug");
  await expectNoAppErrors(page);
  const log = page.locator("#log-list");
  await expect(log).toContainText(/Sunward \S+.* started/);
  await expect(log).toContainText("Year computed for 38.7173, 0.1617");

  // A thrown error is captured, counted on the tab badge and shown with its message.
  await page.evaluate(() => setTimeout(() => { throw new Error("probe uncaught error"); }));
  await expect(log).toContainText("probe uncaught error");
  await expect(page.locator("#log-badge")).toHaveText("1");
  await page.selectOption("#log-filter", "error");
  await expect(page.locator("#log-list .log-row")).toHaveCount(1);

  // Clearing empties the list and hides the badge.
  await page.click("#btn-log-clear");
  await expect(page.locator("#log-list .log-row")).toHaveCount(0);
  await expect(page.locator("#log-badge")).toBeHidden();

  // This test throws on purpose: drop it from the automatic failure check.
  problems.pageErrors = problems.pageErrors.filter((e) => !e.includes("probe uncaught error"));
});

test("the header shows the build's short commit hash and commit date", async ({ page, problems }) => {
  void problems;
  await openAt(page, "lat=40.4168&lon=-3.7038&alt=667");
  const stamp = page.locator("#build-stamp");
  await expect(stamp).toHaveText(/^[0-9a-f]{7} · \d{1,2} \w{3} \d{4}, \d{2}:\d{2}$/);
  await expect(stamp).toHaveAttribute("href", /github\.com\/Agustin-Q\/sunward\/commit\/[0-9a-f]{7}$/);
});
