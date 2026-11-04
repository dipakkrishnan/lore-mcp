import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Every test points at a stubbed GitHub instead of the real API;
        // individual tests control its responses by mocking `globalThis.fetch`
        // (see test/github.ts, modelled on lore/node/test/facilitator.ts).
        bindings: {
          LORE_GITHUB_API: "https://github.test",
          LORE_FEEDBACK_GITHUB_TOKEN: "test-token"
        }
      }
    })
  ],
  test: {
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    // XC-098: report-only coverage, on with `--coverage` (npm run test:coverage). The Workers pool
    // supports the istanbul provider only; CI reads coverage/coverage-summary.json into one line
    // of the step summary. No thresholds until XC-108.
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**"]
    }
  }
});
