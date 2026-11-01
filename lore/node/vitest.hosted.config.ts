import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

// XC-088: Lore's hosted stores run as their own Worker, so their tests get their own pool.
export default defineProject({
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
  },
});
