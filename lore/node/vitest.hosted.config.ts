import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineProject } from "vitest/config";

// XC-088: Lore's hosted stores run as their own Worker, so their tests get their own pool.
export default defineProject({
  plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.hosted.jsonc" }, miniflare: { bindings: { STORE_DOMAIN: "yourlore.test" } } })],
  test: {
    fileParallelism: false,
    include: ["test/hosted/**/*.test.ts"],
    testTimeout: 15_000
  }
});
