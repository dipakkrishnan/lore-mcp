// Manual, unpaid health check: run `npm run smoke` against a local `npm run dev`
// server (or `npm run smoke -- <url>` against a deployed Worker) to verify the
// tools are listed, discover serves the manifest free, and get challenges for
// payment without serving content. It spends nothing. Run it after any Worker
// change and after each deploy, before spending faucet funds on `npm run pay`.
//
// CI's worker-smoke job also runs this, against a Worker it seeded with one
// real `lore push --local` publication (see .github/workflows/tests.yml). It
// sets SMOKE_EXPECT_TOPIC/SMOKE_EXPECT_TEASER so this checks that exact
// publication came back out of discover(), not just that some row exists. A
// manual run against a real deployed node leaves those unset and skips it.
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
    ["answer", "discover", "get", "result"]
  );

  const discover = await client.callTool({
    name: "discover",
    arguments: {}
  });
  assert.equal(discover.isError, undefined);
  // The manifest must advertise without disclosing: teasers and topics are the
  // only text, and the payload shape matches the stdio server's discover.
  const payload: unknown = JSON.parse((discover.content as { text: string }[])[0].text);
  assert.ok(isRecord(payload));
  assert.equal(payload.manifest_version, 1);
  assert.ok(typeof payload.publication_count === "number");
  assert.ok(isRecord(payload.topics));
  for (const entries of Object.values(payload.topics)) {
    assert.ok(Array.isArray(entries));
    for (const entry of entries) {
      assert.ok(isRecord(entry));
      assert.deepEqual(
        Object.keys(entry).sort(),
        ["id", "kind", "teaser", "updated_at"]
      );
    }
  }

  // CI seeds one publication with a real `lore push --local` and expects to
  // find its exact topic/teaser/kind here — proof that what discover() reads
  // is exactly what `lore push` wrote, not a hand-copied fixture that happens
  // to agree with it today.
  const expectedTopic = process.env.SMOKE_EXPECT_TOPIC;
  const expectedTeaser = process.env.SMOKE_EXPECT_TEASER;
  if (expectedTopic !== undefined && expectedTeaser !== undefined) {
    const entries = payload.topics[expectedTopic];
    assert.ok(
      Array.isArray(entries),
      `expected topic ${JSON.stringify(expectedTopic)} in discover() manifest`
    );
    assert.ok(
      entries.some(
        (entry) => isRecord(entry) && entry.teaser === expectedTeaser && entry.kind === "claim"
      ),
      `expected a claim-kind entry with teaser ${JSON.stringify(expectedTeaser)} under topic ${JSON.stringify(expectedTopic)}`
    );
  }

  // A damaged id is rejected before x402 can ask for payment.
  const damaged = await client.callTool({
    name: "get",
    arguments: { id: "000000000000000000000000" }
  });
  assert.equal(damaged.isError, true);
  assert.equal(damaged._meta?.["x402/error"], undefined);

  // A structurally valid id reaches the payment challenge before lookup.
  const get = await client.callTool({
    name: "get",
    arguments: { id: "0000000000000000fcdb4b42" }
  });
  assert.equal(get.isError, true);
  assert.ok(get._meta?.["x402/error"]);
  console.log("free discover manifest and paid get challenge: ok");
} finally {
  await client.close();
}
