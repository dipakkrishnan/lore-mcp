import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Every test points at a stubbed Stripe and a stubbed store (see
        // test/stubs.ts); no test reaches the real Stripe API.
        bindings: {
          STRIPE_API: "https://stripe.test",
          STRIPE_SECRET_KEY: "sk_test_not_a_real_key",
          STRIPE_WEBHOOK_SECRET: "whsec_test_not_a_real_secret",
          ACCOUNT_TOKEN_SECRET: "not_a_real_token_secret"
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
