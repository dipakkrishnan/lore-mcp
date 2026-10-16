import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

export default defineProject({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.jsonc" } })],
  test: {
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    testTimeout: 15_000
  }
});
