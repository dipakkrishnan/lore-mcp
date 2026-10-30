import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Point every test at a stub facilitator instead of the real
        // x402.org endpoint; individual tests control its responses by
        // mocking `globalThis.fetch` (see test/facilitator.ts). The API key
        // is a fixture: the answer tests stub api.anthropic.com the same way.
        bindings: {
          LORE_FACILITATOR_URL: "https://facilitator.test",
          CHECKOUT_URL: "https://checkout.test",
          ANTHROPIC_API_KEY: "test-key"
        }
      }
    })
  ],
  test: {
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    // Lore's hosted stores are another Worker, with their own pool (vitest.hosted.config.ts).
    exclude: ["test/hosted/**"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 15_000,
    // XC-098: report-only coverage, on with `--coverage` (npm run test:coverage). The Workers pool
    // supports the istanbul provider only. src/hosted belongs to the hosted Worker's report
    // (vitest.hosted.config.ts), so the two reports partition src/ and CI sums them into one
    // lore/node line in the step summary (.github/scripts/coverage_summary.py). No thresholds:
    // XC-108 sets floors once a few weeks of numbers exist.
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**"],
      exclude: ["src/hosted/**"]
    }
  }
});
