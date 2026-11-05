import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

// The Workers pool: every file here boots a Worker with D1 and the facilitator stub (XC-099 moved
// the pure modules' tests to test/unit/, which vitest.unit.config.ts runs in plain node).
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
          CHECKOUT_URL: "https://checkout.test",
          ANTHROPIC_API_KEY: "test-key"
        }
      }
    })
  ],
  test: {
    name: "workerd",
    // One file at a time: a Worker boots per file (MCP-003), and the files share the D1 seed in
    // test/setup.ts, mutate env.LORE_WALLET and spy on globalThis.fetch. XC-101 revisits this.
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    // Lore's hosted stores are another Worker, with their own pool (vitest.hosted.config.ts);
    // test/unit/ is the node project (vitest.unit.config.ts).
    exclude: ["test/hosted/**", "test/unit/**"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 15_000
  }
});
