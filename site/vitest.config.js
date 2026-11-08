import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

const RELAY = `import { WorkerEntrypoint } from "cloudflare:workers";
export class SiteEvents extends WorkerEntrypoint { async count() {} }
export default { fetch: () => new Response(null, { status: 204 }) };`;

export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The local workerd binary lags production's dates; this is the newest it runs.
      miniflare: {
        compatibilityDate: "2026-08-22",
        bindings: { BIDS_ADMIN_TOKEN: "test-admin-token" },
        // The relay's SiteEvents entrypoint, stood in for; tests that check a count pass their own RELAY.
        // And a stand-in for Lore's checkout: it never reaches Stripe, and records what it was asked.
        workers: [
          { name: "lore-feedback-relay", modules: true, compatibilityDate: "2026-08-22", script: RELAY },
          { name: "lore-checkout", modules: true, scriptPath: "./test/fake-checkout.js", compatibilityDate: "2026-08-22" }
        ]
      }
    })
  ],
  test: {
    fileParallelism: false,
    include: ["test/**/*.test.js"]
  }
});
