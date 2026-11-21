import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env["BASE_URL"];
const localBaseUrl = "http://127.0.0.1:8787";

/** Tests tagged @heavy (many clients, large documents) run in Chromium only, to keep runs stable. */
const lightOnly = { grepInvert: /@heavy/ };

export default defineConfig({
  testDir: "tests/e2e",
  // Many browsers against one local workerd: two workers keep an 8th-gen i5 laptop from timing out.
  // Playwright's WebKit on Windows is much heavier: two WebKit instances at once made each keystroke
  // ~300 ms instead of ~15 ms, so `npm run test:e2e` runs the WebKit projects separately with one worker.
  workers: 2,
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  reporter: "list",
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: externalBaseUrl ?? localBaseUrl,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, ...lightOnly },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, ...lightOnly },
    { name: "pixel-7", use: { ...devices["Pixel 7"] }, ...lightOnly },
    { name: "iphone-14", use: { ...devices["iPhone 14"] }, ...lightOnly },
  ],
  ...(externalBaseUrl === undefined
    ? {
        webServer: {
          // Test mode (15 s pads, localhost origins) comes only from this flag, never from wrangler.jsonc.
          command: "npm run build && npx wrangler dev --port 8787 --var ALLOW_TEST_TTL:1",
          url: localBaseUrl,
          reuseExistingServer: process.env["CI"] === undefined,
          timeout: 180_000,
        },
      }
    : {}),
});
