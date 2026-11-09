import { defineConfig } from "vitest/config";

// XC-099: two projects under one `vitest run`. `node` (vitest.unit.config.ts) runs the pure
// modules' tests in plain node, files in parallel, in well under a second; `workerd`
// (vitest.workerd.config.ts) is the Workers pool, which starts a runtime per file and runs files in
// parallel (XC-101). `npm run test:unit` and `npm run test:component` pick one.
// Lore's hosted stores are a third pool (vitest.hosted.config.ts, XC-088), run by `npm test`
// with its own `-c`, since it is another Worker with another wrangler config.
export default defineConfig({
  test: {
    projects: ["./vitest.unit.config.ts", "./vitest.workerd.config.ts"],
    // XC-098: report-only coverage, on with `--coverage` (npm run test:coverage). Coverage is a
    // root option: one istanbul report over both projects (the Workers pool supports istanbul
    // only, and it instruments the node project the same). src/hosted belongs to the hosted
    // Worker's report (vitest.hosted.config.ts), so the two reports partition src/ and CI sums
    // them into one lore/node line in the step summary (.github/scripts/coverage_summary.py).
    // No thresholds: XC-108 sets floors once a few weeks of numbers exist.
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      include: ["src/**"],
      exclude: ["src/hosted/**"]
    }
  }
});
