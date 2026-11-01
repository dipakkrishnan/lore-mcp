import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      // The local workerd binary lags production's dates; this is the newest it runs.
      miniflare: { compatibilityDate: "2026-08-22", bindings: { BIDS_ADMIN_TOKEN: "test-admin-token" } }
    })
  ],
  test: {
    fileParallelism: false,
    include: ["test/**/*.test.js"]
  }
});
