import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

// The Workers pool: every file here boots checkout with the stubbed Stripe and the fake site
// (XC-099 moved the pure modules' tests to test/unit/, which vitest.unit.config.ts runs in plain
// node).
export default defineProject({
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
          STRIPE_PLATFORM_WEBHOOK_SECRET: "whsec_test_platform_not_a_real_secret",
          ACCOUNT_TOKEN_SECRET: "not_a_real_token_secret"
        },
        // A stand-in for yourlore.dev's BidRail entrypoint, recording what the rail told it.
        workers: [{ name: "yourlore-site", modules: true, scriptPath: "./test/fake-site.js", compatibilityDate: "2026-06-11" }]
      }
    })
  ],
  test: {
    name: "workerd",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    // test/unit/ is the node project (vitest.unit.config.ts).
    exclude: ["test/unit/**"]
  }
});
