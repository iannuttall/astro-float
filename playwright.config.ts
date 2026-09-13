import { defineConfig, devices } from "@playwright/test";

/**
 * Browser tests drive the demo site in headless Chromium. `e2e/global-setup.ts`
 * starts `astro dev` on a free port and snapshots the demo content; every test
 * puts the content back afterwards, so the tests share one server but run one
 * at a time.
 */
export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["github"]] : "list",
  outputDir: "test-results",
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    // The demo renders dates with Intl; pin the locale so the on-page text is predictable.
    locale: "en-US",
    timezoneId: "UTC",
  },
});
