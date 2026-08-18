import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

export default defineProject({
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
          ANTHROPIC_API_KEY: "test-key"
        }
      }
    })
  ],
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"]
  }
});
