import { defineProject } from "vitest/config";

// XC-099: the pure modules' tests. Nothing here boots a Worker: no binding, no stubbed Stripe
// behind `exports.default.fetch`, no `cloudflare:workers`, so the files run in plain node, in
// parallel. test/unit/guard.test.ts fails the project if a file under test/unit/ reaches
// `cloudflare:workers` or `cloudflare:test`, directly or through a helper; such a test belongs
// in vitest.workerd.config.ts.
export default defineProject({
  test: {
    name: "node",
    environment: "node",
    include: ["test/unit/**/*.test.ts"]
  }
});
