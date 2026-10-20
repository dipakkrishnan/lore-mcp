// APP-066: every persona `npm run test:edge` runs also has its own step in CI, so a renderer regression
// cannot pass review just because nobody ran the attended walks.
const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

const read = (...parts) => readFileSync(join(__dirname, "..", ...parts), "utf8");

test("every test:edge persona has a step in the CI workflow", () => {
  const script = JSON.parse(read("package.json")).scripts["test:edge"];
  const personas = [...script.matchAll(/support\/edge\.sh (\w+)/g)].map((m) => m[1]);
  assert.ok(personas.length > 0, "test:edge lists no personas");
  const workflow = readFileSync(join(__dirname, "..", "..", "..", ".github", "workflows", "tests.yml"), "utf8");
  const ci = new Set([...workflow.matchAll(/run: support\/edge\.sh (\w+)/g)].map((m) => m[1]));
  const missing = personas.filter((persona) => !ci.has(persona));
  assert.deepEqual(missing, [], `test:edge personas with no CI step in .github/workflows/tests.yml: ${missing.join(", ")}`);
});
