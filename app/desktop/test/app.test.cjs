const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, writeFile } = require("node:fs/promises");
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

test("useRuntime runs the packaged binary instead of uv", async () => {
  const { useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const bin = join(directory, "lore");
    await writeFile(bin, '#!/bin/sh\necho \'{"version":1}\'\n', { mode: 0o755 });
    useRuntime(bin);
    const state = await readState(directory);
    assert.equal(state.version, 1);
  } finally {
    useRuntime();
    await rm(directory, { recursive: true });
  }
});

async function bashHandler(approve, stopped) {
  const { bashPolicyExtension } = await import("../src/agent.mjs");
  let handler;
  await bashPolicyExtension(approve, stopped).factory({
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
    "lore search Kestrel --status private --limit 0 --json",
    "lore blueprint show",
    "lore publication list",
    `lore publication draft - <<'LORE_PUBLISH'\n[{"title":"x","teaser":"y","content":"z","topic":"t","provenance":[1]}]\nLORE_PUBLISH`,
    "which claude codex",
    'ls "${CLAUDE_HOME:-$HOME/.claude}/projects"',
    'ls "${CLAUDE_HOME:-$HOME/.claude}"/projects/*/memory/*.md 2>/dev/null',
    'ls "${CODEX_HOME:-$HOME/.codex}/memories" "${CODEX_HOME:-$HOME/.codex}/automations" 2>/dev/null',
    'ls -lt "${CLAUDE_HOME:-$HOME/.claude}"/projects/*/*.jsonl 2>/dev/null',
    `cat > "\${LORE_HOME:-$HOME/.lore}/automation/onboarding.json" <<'LORE_CHECKPOINT'\n{"phase1_done":true,"role":"maintainer","domains":"systems","valuable_context":"reviews","preferences":"concise","boundaries":"private","executor":"claude","model":"sonnet","cadence":"daily","hour":21}\nLORE_CHECKPOINT`
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
  const refusal = await denied(bashEvent(command));
  assert.equal(refusal.block, true);
  assert.equal(refusal.terminate, undefined);
  assert.match(refusal.reason, /owner chose not to/);

  const allowed = await bashHandler(async (actual, action) => {
    assert.equal(actual, command);
    assert.deepEqual(action, {
      kind: "capture",
      entries: [{ title: "Rollback rehearsal", content: "Rehearse before cutover.", project: "Juniper" }]
    });
    return true;
  });
  assert.equal(await allowed(bashEvent(command)), undefined);
});

test("only a non-empty array of titled memories counts as a capture", async () => {
  const { classifyBash } = await import("../src/agent.mjs");
  const wrap = (body) => `lore capture apply - <<'LORE_CAPTURE'\n${body}\nLORE_CAPTURE`;
  assert.equal(classifyBash(wrap("[]")), null);
  assert.equal(classifyBash(wrap('{"title":"x","content":"y"}')), null);
  assert.equal(classifyBash(wrap('[{"title":"x"}]')), null);
  assert.equal(classifyBash(wrap("not json")), null);
  assert.deepEqual(classifyBash(wrap('[{"title":"x","content":"y"}]')), { kind: "capture", entries: [{ title: "x", content: "y" }] });
});

test("setup writes ask once each and carry what they mean", async () => {
  const { classifyBash } = await import("../src/agent.mjs");
  const blueprint = { version: 1, name: "Ada", persona: "professor", topic_outline: ["consensus"], storytelling: "Lectures." };
  const profile = { role: "maintainer", executor: "claude", cadence: "daily", hour: 21 };
  assert.deepEqual(classifyBash("lore setup --yes"), { kind: "import" });
  assert.deepEqual(
    classifyBash(`lore blueprint apply - <<'LORE_BLUEPRINT'\n${JSON.stringify(blueprint, null, 2)}\nLORE_BLUEPRINT`),
    { kind: "blueprint", fields: blueprint }
  );
  assert.deepEqual(classifyBash(`lore profile - <<'LORE_PROFILE'\n${JSON.stringify(profile)}\nLORE_PROFILE`), { kind: "profile", fields: profile });
  for (const body of ["[]", '["x"]', "not json", "null", '"text"']) {
    assert.equal(classifyBash(`lore blueprint apply - <<'LORE_BLUEPRINT'\n${body}\nLORE_BLUEPRINT`), null, body);
    assert.equal(classifyBash(`lore profile - <<'LORE_PROFILE'\n${body}\nLORE_PROFILE`), null, body);
  }
});

test("a malformed checkpoint is refused with the reason and the turn goes on", async () => {
  const { classifyBash } = await import("../src/agent.mjs");
  let prompted = false;
  const handler = await bashHandler(async () => {
    prompted = true;
    return true;
  });
  const wrap = (/** @type {string} */ body) => `cat > "\${LORE_HOME:-$HOME/.lore}/automation/onboarding.json" <<'LORE_CHECKPOINT'\n${body}\nLORE_CHECKPOINT`;
  const full = { phase1_done: false, role: "", domains: "", valuable_context: "", preferences: "", boundaries: "", executor: "", model: "", cadence: "daily", hour: 21 };
  assert.equal(classifyBash(wrap(JSON.stringify(full))), "allow");
  assert.equal(classifyBash(wrap(JSON.stringify({ ...full, name: "Ada", persona: "professor", topic_outline: ["consensus"], focus_topics: [], general_areas: [], storytelling: "Lectures." }))), "allow");
  for (const [body, reason] of [
    ["{}", /"phase1_done" is missing/],
    ["not json", /not valid JSON/],
    ["[]", /must be a JSON object/],
    [`{}\nLORE_CHECKPOINT\nrm -rf ~`, /not valid JSON/],
    [JSON.stringify({ ...full, path: "/etc/passwd" }), /"path" is not a checkpoint field/],
    [JSON.stringify({ ...full, role: {} }), /"role" must be a string/],
    [JSON.stringify({ ...full, model: null }), /"model" must be a string/],
    [JSON.stringify({ ...full, topic_outline: "consensus" }), /"topic_outline" must be a list of strings/],
    [JSON.stringify({ ...full, cadence: "monthly" }), /"cadence" must be "daily" or "weekly"/],
    [JSON.stringify({ ...full, hour: 24 }), /"hour" must be a whole number from 0 to 23/]
  ]) {
    const result = await handler(bashEvent(wrap(body)));
    assert.equal(result.block, true, body);
    assert.equal(result.terminate, undefined, body);
    assert.match(result.reason, /** @type {RegExp} */ (reason), body);
  }
  assert.equal(prompted, false);
});

test("hard-denies malformed, non-Lore, compound, and owner-only commands", async () => {
  let prompted = false;
  let stopped = 0;
  const handler = await bashHandler(async () => {
    prompted = true;
    return true;
  }, () => { stopped += 1; });
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
    "lore node deploy",
    "lore setup",
    "lore setup --yes --source codex",
    "lore blueprint apply blueprint.json",
    "lore blueprint apply - <<'EOF'\n{}\nEOF",
    "lore blueprint apply - < blueprint.json",
    "lore profile ~/.lore/automation/onboarding.json",
    "lore profile - --no-schedule <<'LORE_PROFILE'\n{}\nLORE_PROFILE",
    "lore review",
    "which claude codex lore",
    "which claude",
    "ls ~/.claude/projects",
    'ls "${CLAUDE_HOME:-$HOME/.claude}/projects" | head -50',
    'ls "${CLAUDE_HOME:-$HOME/.claude}/projects"; cat ~/.ssh/id_rsa',
    'ls "${CLAUDE_HOME:-$HOME/.claude}"/projects/*/*.jsonl 2>/dev/null',
    'ls -la "${CLAUDE_HOME:-$HOME/.claude}/projects"',
    'ls "${CODEX_HOME:-$HOME/.codex}"',
    'cat "${LORE_HOME:-$HOME/.lore}/automation/onboarding.json"',
    `cat > "$LORE_HOME/automation/onboarding.json" <<'LORE_CHECKPOINT'\n{}\nLORE_CHECKPOINT`,
    `cat > "\${LORE_HOME:-$HOME/.lore}/automation/profile.json" <<'LORE_CHECKPOINT'\n{}\nLORE_CHECKPOINT`,
    `cat > "\${LORE_HOME:-$HOME/.lore}/automation/onboarding.json" <<'EOF'\n{}\nEOF`,
    `cat >> "\${LORE_HOME:-$HOME/.lore}/automation/onboarding.json" <<'LORE_CHECKPOINT'\n{}\nLORE_CHECKPOINT`
  ];
  for (const command of commands) {
    const result = await handler(bashEvent(command));
    assert.equal(result.block, true, command);
    assert.equal(result.terminate, true, command);
  }
  assert.equal(prompted, false);
  assert.equal(stopped, commands.length);
});

test("sessions persist per task, come back as a thread, and a cut-off tool call is closed out", async () => {
  const { LoreAgent } = await import("../src/agent.mjs");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    assert.deepEqual(LoreAgent.history(home, "setup"), []);
    const written = LoreAgent.sessionFor(home, "setup");
    written.appendMessage({ role: "user", content: "/skill:lore-onboard\n\nLet's set up my Lore.", timestamp: 1 });
    written.appendMessage({ role: "assistant", content: [{ type: "text", text: "Welcome." }, { type: "toolCall", id: "call-1", name: "ask_user", arguments: {} }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 2 });
    written.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "ask_user", content: [{ type: "text", text: JSON.stringify({ answers: { Persona: "College professor", Name: "Ada" } }) }], isError: false, timestamp: 3 });
    written.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "call-2", name: "bash", arguments: { command: "lore status" } }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 4 });
    assert.match(String(written.getSessionFile()), new RegExp(`^${home}/\\.pi/sessions/setup/`));
    assert.deepEqual(LoreAgent.history(home, "setup"), [
      { text: "Let's set up my Lore.", owner: true },
      { text: "Welcome.", owner: false },
      { text: "College professor · Ada", owner: true }
    ]);
    const resumed = LoreAgent.sessionFor(home, "setup");
    const messages = resumed.buildSessionContext().messages;
    assert.equal(messages.length, 5);
    assert.deepEqual({ role: messages[4].role, toolCallId: messages[4].toolCallId, isError: messages[4].isError }, { role: "toolResult", toolCallId: "call-2", isError: true });
    assert.equal(SessionManager.create(home).buildSessionContext().messages.length, 0);
    assert.equal(LoreAgent.sessionFor(home, "capture").buildSessionContext().messages.length, 0);
  } finally {
    await rm(home, { recursive: true });
  }
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

test("memory reads validate the id before any CLI call, and say when it is unknown", async () => {
  const { readMemory } = require("../src/state.cjs");
  for (const bad of [0, -1, 1.5, "1", null]) await assert.rejects(readMemory("/nonexistent", bad), { message: /Invalid memory/ });
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    await assert.rejects(readMemory(directory, 999), { message: /memory not found: 999/ });
  } finally {
    await rm(directory, { recursive: true });
  }
});
