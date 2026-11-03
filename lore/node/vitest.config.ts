import { defineConfig } from "vitest/config";

// XC-099: two projects under one `vitest run`. `node` (vitest.unit.config.ts) runs the pure
// modules' tests in plain node, files in parallel, in well under a second; `workerd`
// (vitest.workerd.config.ts) is the Workers pool, which boots a Worker per file and so runs
// one file at a time. `npm run test:unit` and `npm run test:component` pick one.
// Lore's hosted stores are a third pool (vitest.hosted.config.ts, XC-088), run by `npm test`
// with its own `-c`, since it is another Worker with another wrangler config.
export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./vitest.workerd.config.ts"]
  }
});
