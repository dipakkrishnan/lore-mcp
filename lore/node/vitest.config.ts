import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        // Point every test at a stub facilitator instead of the real
        // x402.org endpoint; individual tests control its responses by
        // mocking `globalThis.fetch` (see test/facilitator.ts).
        bindings: { LORE_FACILITATOR_URL: "https://facilitator.test" }
      }
    })
  ],
  test: {
    setupFiles: ["./test/setup.ts"]
  }
});
