import { defineConfig } from "vitest/config";

// XC-099: two projects under one `vitest run`. `node` (vitest.unit.config.ts) runs the pure
// modules' tests in plain node, files in parallel; `workerd` (vitest.workerd.config.ts) is the
// Workers pool, which boots a Worker per file and so runs one file at a time.
// `npm run test:unit` and `npm run test:component` pick one.
export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./vitest.workerd.config.ts"],
    // XC-098: coverage, on with `--coverage` (npm run test:coverage). Coverage is a root option:
    // one istanbul report over both projects (the Workers pool supports istanbul only, and it
    // instruments the node project the same); CI reads coverage/coverage-summary.json into one
    // line of the step summary.
    // XC-108: `thresholds` is the floor; below it `npm run test:coverage`, and so CI's component
    // tests, fail. Set 2026-11-09 a little under main's numbers (808a33d8, run 42584807851):
    // statements 100% (211/211), branches 100% (166/166). Never lower it, and never exclude a file
    // to meet it.
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**"],
      thresholds: { statements: 99, branches: 99 }
    }
  }
});
