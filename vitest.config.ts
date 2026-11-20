import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.jsonc" },
            // Test mode (15 s TTL, localhost origins) without relying on the gitignored .dev.vars.
            miniflare: { bindings: { ALLOW_TEST_TTL: "1" } },
          }),
        ],
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
        },
      },
    ],
  },
});
