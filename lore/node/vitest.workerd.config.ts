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
        // mocking `globalThis.fetch` (see test/facilitator.ts). This is the
        // only place the override is set — wrangler.jsonc's default vars
        // deliberately carry none (MON-042). The API key
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
    // Files run in parallel (XC-101). It is safe because nothing crosses a file: this pool (0.23)
    // starts a Miniflare of its own for each file, so each file has its own workerd, its own D1
    // (test/setup.ts seeds it per file), and its own isolate, where the env.LORE_WALLET mutation
    // and the globalThis.fetch spies stay. MCP-003 ran files one at a time while a Worker cold start
    // took most of a test's timeout. XC-101 cut the files that boot one to seven (paid-path, answer,
    // agent, card, free, collections, empty-store), so fewer start at once, and the hooks that
    // warm a file's Worker carry 30-60 s timeouts. If cold starts begin timing out here, set this
    // back to false before raising timeouts.
    fileParallelism: true,
    include: ["test/**/*.test.ts"],
    // Lore's hosted stores are another Worker, with their own pool (vitest.hosted.config.ts);
    // test/unit/ is the node project (vitest.unit.config.ts).
    exclude: ["test/hosted/**", "test/unit/**"],
    setupFiles: ["./test/setup.ts"],
    testTimeout: 15_000
  }
});
