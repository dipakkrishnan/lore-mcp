// XC-108 proof, never merged: a node-project test that imports cloudflare:workers.
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("reads the Worker's env", () => {
  expect(env).toBeDefined();
});
