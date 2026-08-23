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
    "lore search Kestrel --status private --limit 0 --json"
  ];
  for (const command of commands) assert.equal(await handler(bashEvent(command)), undefined);
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
    "lore publication list",
    "lore price",
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
