import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// The tests live outside `lore/node/` on purpose: `lore/node/package.json` ships
// inside the wheel, and every dependency listed there is installed on an owner's
// machine by `lore node deploy`. Test tooling has no business in that install.
// Bare imports inside `lore/node/src/*.ts` still resolve from
// `lore/node/node_modules`, because Node resolves them relative to the importing
// file, not to this package.
//
// These run in workerd rather than Node so the modules under test are exercised
// by the runtime that will actually execute them. See `docs/backlog/` XC-013 for
// why the Worker's request handling is not tested here yet.
export default defineWorkersConfig({
  test: {
    include: ["*.test.ts"],
    poolOptions: {
      workers: {
        // The Worker is configured exactly as it deploys; a test that invented
        // its own bindings would stop reflecting what owners run.
        wrangler: { configPath: "../../lore/node/wrangler.jsonc" },
        miniflare: {
          bindings: { LORE_WALLET: `0x${"1".repeat(40)}` }
        }
      }
    }
  }
});
