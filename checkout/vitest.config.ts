import { defineConfig } from "vitest/config";

// XC-099: two projects under one `vitest run`. `node` (vitest.unit.config.ts) runs the pure
// modules' tests in plain node, files in parallel; `workerd` (vitest.workerd.config.ts) is the
// Workers pool, which boots a Worker per file and so runs one file at a time.
// `npm run test:unit` and `npm run test:component` pick one.
export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./vitest.workerd.config.ts"]
  }
});
