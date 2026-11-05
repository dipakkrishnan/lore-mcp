import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

// The Workers pool: every file here boots the relay with its quota Durable Object and the stubbed
// GitHub (XC-099 moved the pure modules' tests to test/unit/, which vitest.unit.config.ts runs in
// plain node).
export default defineProject({
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
    name: "workerd",
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    // test/unit/ is the node project (vitest.unit.config.ts).
    exclude: ["test/unit/**"]
  }
});
