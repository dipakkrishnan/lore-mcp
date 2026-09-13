import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

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
    fileParallelism: false,
    include: ["test/**/*.test.ts"]
  }
});
