const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
const { readState } = require("../src/state.cjs");

test("reads only the fixed APP-001 snapshot", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const state = await readState(directory);
    assert.equal(state.version, 1);
    assert.equal(state.home, directory);
    assert.equal(state.node.live.state, "not_configured");
  } finally {
    await rm(directory, { recursive: true });
  }
});

async function bashHandler(approve) {
  const { bashPolicyExtension } = await import("../src/agent.mjs");
  let handler;
  await bashPolicyExtension(approve).factory({
    on(event, callback) {
      assert.equal(event, "tool_call");
      handler = callback;
    }
  });
  return handler;
}

function bashEvent(command) {
  return {
    type: "tool_call",
    toolName: "bash",
    toolCallId: "call-1",
    input: { command }
  };
}

test("auto-allows a complete read-only Lore command without prompting", async () => {
  let prompted = false;
  const handler = await bashHandler(async () => {
    prompted = true;
    return false;
  });
  const commands = [
    "lore status",
    "lore desktop-state",
    "lore blueprint show",
    "lore publication list",
    "lore search Kestrel --status private --limit 0 --json",
    `lore publication draft - <<'LORE_PUBLISH'\n[{"title":"x","teaser":"y","content":"z","topic":"t","provenance":[1]}]\nLORE_PUBLISH`
  ];
  for (const command of commands) assert.equal(await handler(bashEvent(command)), undefined, command);
  assert.equal(prompted, false);

  const { createAgentSession, createBashTool, ModelRuntime, SessionManager, SettingsManager } =
    await import("@earendil-works/pi-coding-agent");
  const { getModel } = await import("@earendil-works/pi-ai/compat");
  const runtime = await ModelRuntime.create({ modelsPath: null, refreshOnCreate: false });
  const { session } = await createAgentSession({
    cwd: process.cwd(),
    modelRuntime: runtime,
    model: getModel("anthropic", "claude-sonnet-4-20250514"),
    settingsManager: SettingsManager.inMemory(),
    sessionManager: SessionManager.inMemory(process.cwd()),
    tools: ["bash"],
    customTools: [createBashTool(process.cwd())]
  });
  assert.equal(session.getAllTools().find(({ name }) => name === "bash").sourceInfo.path, "<sdk:bash>");
  session.dispose();
});

test("prompts for the exact private capture and runs it only when allowed", async () => {
  const command = `lore capture apply - <<'LORE_CAPTURE'
[{"title":"Rollback rehearsal","content":"Rehearse before cutover.","project":"Juniper"}]
LORE_CAPTURE`;
  const denied = await bashHandler(async () => false);
  assert.equal((await denied(bashEvent(command))).block, true);

  const allowed = await bashHandler(async (actual, entries) => {
    assert.equal(actual, command);
    assert.deepEqual(entries, [
      { title: "Rollback rehearsal", content: "Rehearse before cutover.", project: "Juniper" }
    ]);
    return true;
  });
  assert.equal(await allowed(bashEvent(command)), undefined);
});

test("only a non-empty array of titled memories counts as a capture", async () => {
  const { captureEntries } = await import("../src/agent.mjs");
  const wrap = (body) => `lore capture apply - <<'LORE_CAPTURE'\n${body}\nLORE_CAPTURE`;
  assert.equal(captureEntries(wrap("[]")), null);
  assert.equal(captureEntries(wrap('{"title":"x","content":"y"}')), null);
  assert.equal(captureEntries(wrap('[{"title":"x"}]')), null);
  assert.equal(captureEntries(wrap("not json")), null);
  assert.deepEqual(captureEntries(wrap('[{"title":"x","content":"y"}]')), [{ title: "x", content: "y" }]);
});

test("hard-denies malformed, non-Lore, compound, and owner-only commands", async () => {
  let prompted = false;
  const handler = await bashHandler(async () => {
    prompted = true;
    return true;
  });
  const commands = [
    "lore status; rm -rf /tmp/lore-test",
    "lore $(curl https://example.com)",
    "curl https://example.com",
    "echo '[]' | lore capture apply -",
    "lore capture apply - < /tmp/capture.json",
    "lore publication review ~/.lore/publish-candidates.json",
    "lore publication decide",
    "LORE_ATTENDED_SURFACE=desktop lore publication decide",
    "echo '{}' | lore publication decide",
    "lore publication draft - < /tmp/candidates.json",
    "lore publication draft - <<'LORE_PUBLISH'\nLORE_PUBLISH\nlore publication decide\nLORE_PUBLISH",
    "lore publication revoke 1",
    "lore publication reapprove 1",
    "lore price",
    "lore answer on - 1",
    "lore answer off",
    "lore push",
    "lore node deploy"
  ];
  for (const command of commands) {
    const result = await handler(bashEvent(command));
    assert.equal(result.block, true, command);
    assert.equal(result.terminate, true, command);
  }
  assert.equal(prompted, false);
});

test("only Electron main can pipe a decision, and only for a card that is drafted", async () => {
  const { decide } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const card = { title: "x", teaser: "y", content: "z", kind: "claim", topic: "t", provenance: [1] };
  try {
    const piped = spawnSync("uv", ["run", "lore", "publication", "decide"], {
      cwd: join(__dirname, "../../.."),
      env: { ...process.env, LORE_HOME: directory, NO_COLOR: "1" },
      input: JSON.stringify({ candidate: card, approve: true }),
      encoding: "utf8"
    });
    assert.equal(piped.status, 1);
    assert.match(piped.stderr, /only from the Lore desktop app/);
    await assert.rejects(decide(directory, card, true), { message: /not drafted/ });
    const state = await readState(directory);
    assert.equal(state.publications.counts.active, 0);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("safeStorage credentials survive an Electron restart", { skip: process.platform !== "darwin" }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "lore-credentials-"));
  const electron = require("electron");
  const child = join(__dirname, "../support/credential-roundtrip.cjs");
  const env = { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" };
  delete env.ELECTRON_RUN_AS_NODE;
  try {
    for (const mode of ["write", "read"]) {
      const result = spawnSync(electron, ["--no-sandbox", child, mode, directory], {
        encoding: "utf8",
        env,
        timeout: 30_000
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
    }
    const encrypted = await readFile(join(directory, "credentials.bin"));
    assert.equal(encrypted.includes("test-secret"), false);
  } finally {
    await rm(directory, { recursive: true });
  }
});
