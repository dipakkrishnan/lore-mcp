import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Every test points at a stubbed Stripe and a stubbed store (see
        // test/stubs.ts); no test reaches the real Stripe API.
        bindings: {
          STRIPE_API: "https://stripe.test",
          STRIPE_SECRET_KEY: "sk_test_not_a_real_key"
        }
      }
    })
  ],
  test: {
    fileParallelism: false,
    include: ["test/**/*.test.ts"]
  }
});
