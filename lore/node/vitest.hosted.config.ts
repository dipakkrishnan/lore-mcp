import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

// XC-088: Lore's hosted stores run as their own Worker, so their tests get their own pool.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.hosted.jsonc" },
      miniflare: {
        bindings: { STORE_DOMAIN: "yourlore.test" },
        // The zone's other Workers, each answering with its own name and the address it was handed.
        serviceBindings: Object.fromEntries(
          ["RELAY", "CHECKOUT", "SITE"].map((name) => [
            name,
            (request: Request) => Response.json({ name, url: request.url }),
          ]),
        ),
      },
    }),
  ],
  test: {
    fileParallelism: false,
    include: ["test/hosted/**/*.test.ts"],
    testTimeout: 15_000,
    // XC-098: this Worker's half of lore/node's coverage (see vitest.config.ts); its own
    // directory so the main run's coverage-summary.json survives.
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "coverage/hosted",
      include: ["src/hosted/**"],
    },
  },
});
