// Manual, unpaid health check: run `npm run smoke` against a local `npm run dev`
// server (or `npm run smoke -- <url>` against a deployed Worker) to verify the
// tools are listed, discover is free, and answer challenges for payment without
// serving content. It spends nothing and is not wired into CI — run it after any
// Worker change and after each deploy, before spending faucet funds on `npm run pay`.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

// Flatten a result to `path=value` leaves, so two challenges can be compared
// without asserting on a shape that the x402 library is free to change.
function leaves(value: unknown, path = ""): Map<string, string> {
  const found = new Map<string, string>();
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      for (const [k, v] of leaves(child, path ? `${path}.${key}` : key)) {
        found.set(k, v);
      }
    }
  } else {
    found.set(path, String(value));
  }
  return found;
}

function differing(a: Map<string, string>, b: Map<string, string>): Set<string> {
  const keys = new Set([...a.keys(), ...b.keys()]);
  return new Set([...keys].filter((key) => a.get(key) !== b.get(key)));
}

const endpoint = process.argv[2] ?? "http://localhost:8787/mcp";
const client = new Client({ name: "lore-canary-smoke", version: "0.1.0" });
await client.connect(
  new StreamableHTTPClientTransport(new URL(endpoint), {
    // Fail rather than hang if the Worker stops responding.
    requestInit: { signal: AbortSignal.timeout(10_000) }
  })
);

try {
  const tools = await client.listTools();
  assert.deepEqual(
    tools.tools.map(({ name }) => name).sort(),
    ["answer", "discover"]
  );

  const discover = await client.callTool({
    name: "discover",
    arguments: { query: "Lore" }
  });
  assert.equal(discover.isError, undefined);

  const answer = await client.callTool({
    name: "answer",
    arguments: { query: "What is Lore?" }
  });
  assert.equal(answer.isError, true);
  assert.ok(answer._meta?.["x402/error"]);
  console.log("free discover and paid answer challenge: ok");

  // Invariant: the challenge discloses no publication content.
  //
  // A gate that leaks the answer inside the demand for payment is worse than no
  // gate — the buyer keeps both the content and the money, and nothing errors.
  // Asserting on a blocklist of strings would only prove that today's rows are
  // absent, so this asserts the stronger property instead: the challenge does
  // not depend on the query at all. If asking about two unrelated things
  // produced two different challenges, the difference would be something the
  // gate learned from the publications before being paid.
  //
  // Volatile fields (nonces, timestamps, expiries) are discovered rather than
  // hardcoded: call twice with the same query, and whatever moves is noise.
  const repeat = await client.callTool({
    name: "answer",
    arguments: { query: "What is Lore?" }
  });
  const unrelated = await client.callTool({
    name: "answer",
    arguments: { query: "zzzz-nonexistent-topic-zzzz" }
  });
  assert.equal(unrelated.isError, true, "an unmatched query must still be charged");

  const volatile = differing(leaves(answer), leaves(repeat));
  const acrossQueries = differing(leaves(answer), leaves(unrelated));
  const leaked = [...acrossQueries].filter((key) => !volatile.has(key));
  assert.deepEqual(
    leaked,
    [],
    `the payment challenge varies with the query, so it discloses something ` +
      `about what matched before payment: ${leaked.join(", ")}`
  );

  // Structural belt-and-braces: whatever else the challenge carries, it must
  // not carry the paid payload's shape.
  const rendered = JSON.stringify(answer);
  for (const forbidden of ["answer_context", "\"content\":\""]) {
    assert.ok(
      !rendered.includes(forbidden),
      `the challenge contains ${forbidden}, which belongs only in a paid answer`
    );
  }
  console.log("challenge discloses no publication content: ok");
} finally {
  await client.close();
}
