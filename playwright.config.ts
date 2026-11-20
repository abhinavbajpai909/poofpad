import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env["BASE_URL"];
const localBaseUrl = "http://127.0.0.1:8787";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  reporter: "list",
  use: {
    baseURL: externalBaseUrl ?? localBaseUrl,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "pixel-7", use: { ...devices["Pixel 7"] } },
    { name: "iphone-14", use: { ...devices["iPhone 14"] } },
  ],
  ...(externalBaseUrl === undefined
    ? {
        webServer: {
          command: "npm run build && npx wrangler dev --port 8787",
          url: localBaseUrl,
          reuseExistingServer: process.env["CI"] === undefined,
        },
      }
    : {}),
});
