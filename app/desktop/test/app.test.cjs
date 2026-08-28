const assert = require("node:assert/strict");
const { mkdtemp, readFile, rm, symlink, writeFile } = require("node:fs/promises");
const { homedir, tmpdir } = require("node:os");
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

test("the desktop agent has Pi's normal file and shell tools", async () => {
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
    tools: ["read", "write", "edit", "bash"],
    customTools: [createBashTool(process.cwd())]
  });
  assert.deepEqual(session.getActiveToolNames().sort(), ["bash", "edit", "read", "write"]);
  assert.equal(session.getAllTools().find(({ name }) => name === "bash").sourceInfo.path, "<sdk:bash>");
  session.dispose();
});

test("desktop Bash is confined to Lore", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedBashOperations, initializeBashSandbox } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const real = await mkdtemp(join(tmpdir(), "lore-sandbox-"));
  const home = `${real}-link`;
  await symlink(real, home);
  const inside = join(home, "inside");
  const escaped = `${real}-escaped`;
  const output = [];
  const run = (task, command) => createSandboxedBashOperations(home, task).exec(command, home, { onData: (data) => output.push(data) });
  try {
    await initializeBashSandbox(home);
    const result = await run("capture", `printf inside > ${JSON.stringify(inside)}; printf escaped > ${JSON.stringify(escaped)}`);
    assert.equal(result.exitCode, 1);
    assert.equal(await readFile(inside, "utf8"), "inside");
    await assert.rejects(readFile(escaped, "utf8"), { code: "ENOENT" });
    assert.match(Buffer.concat(output).toString(), /Operation not permitted|sandbox_violations/);
    assert.equal((await run("capture", 'printf "$TMPDIR" > "$TMPDIR/probe" && cat "$TMPDIR/probe"')).exitCode, 0);
    assert.deepEqual(SandboxManager.getNetworkRestrictionConfig().allowedHosts, []);
    await run("deploy", "true");
    assert.deepEqual(SandboxManager.getNetworkRestrictionConfig().allowedHosts, ["*"]);
    await run("setup", "true");
    assert.ok(SandboxManager.getFsWriteConfig().allowOnly.includes(join(homedir(), ".codex/automations")));
    await run("capture", "true");
    assert.deepEqual(SandboxManager.getNetworkRestrictionConfig().allowedHosts, []);
  } finally {
    await SandboxManager.reset();
    await rm(real, { recursive: true, force: true });
    await rm(home, { force: true });
    await rm(escaped, { force: true });
  }
});

test("switching tasks updates the live network policy the proxy actually filters against", { skip: process.platform !== "darwin" }, async () => {
  const { createSandboxedBashOperations, initializeBashSandbox } = await import("../src/agent.mjs");
  const { SandboxManager } = await import("@anthropic-ai/sandbox-runtime");
  const home = await mkdtemp(join(tmpdir(), "lore-sandbox-net-"));
  try {
    // initializeBashSandbox() always starts the session with the "capture"
    // policy (empty network allowlist) regardless of which task runs first.
    await initializeBashSandbox(home);
    assert.deepEqual(SandboxManager.getConfig().network.allowedDomains, []);
    // filterNetworkRequest — the mux proxy's live per-request filter — reads
    // only this session-level config, never the customConfig exec() passes to
    // wrapWithSandbox. Running a "deploy" command must update it in place, or
    // deploy stays filtered against "capture"'s empty allowlist forever.
    const result = await createSandboxedBashOperations(home, "deploy").exec("true", home, { onData: () => {} });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(SandboxManager.getConfig().network.allowedDomains, ["*"]);
    // And it swaps back for the next "capture" command in the same session.
    await createSandboxedBashOperations(home, "capture").exec("true", home, { onData: () => {} });
    assert.deepEqual(SandboxManager.getConfig().network.allowedDomains, []);
  } finally {
    await SandboxManager.reset();
    await rm(home, { recursive: true, force: true });
  }
});

test("the dictation helper builds and speaks the line protocol", { skip: process.platform !== "darwin" }, () => {
  const build = spawnSync(join(__dirname, "../packaging/dictate.sh"), { encoding: "utf8" });
  assert.equal(build.status, 0, build.stderr);
  const source = require("node:fs").readFileSync(join(__dirname, "../packaging/dictate.swift"), "utf8");
  for (const kind of ["ready", "partial", "final", "error"]) assert.ok(source.includes(`"${kind}"`), kind);
});

test("a streamed CLI command hands back each line and fails on a non-zero exit", async () => {
  const { loreStream, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const fake = join(directory, "lore");
  await writeFile(fake, '#!/bin/sh\necho "Visit this link to authenticate: https://dash.cloudflare.com/oauth2/auth?x=1"\ntest "$2" = login && exit 0\necho "lore: Cloudflare sign-in did not complete" >&2\nexit 1\n', { mode: 0o755 });
  const lines = [];
  try {
    useRuntime(fake);
    await loreStream(directory, ["node", "login"], (line) => lines.push(line));
    assert.match(lines[0], /^Visit this link/);
    await assert.rejects(loreStream(directory, ["node", "deploy"], (line) => lines.push(line)), /exited with 1/);
    assert.equal(lines.at(-1), "lore: Cloudflare sign-in did not complete");
  } finally {
    useRuntime();
    await rm(directory, { recursive: true });
  }
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
    written.appendMessage({ role: "toolResult", toolCallId: "old-call", toolName: "ask_user", content: [{ type: "text", text: "old malformed result" }], isError: false, timestamp: 3 });
    written.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "call-2", name: "bash", arguments: { command: "lore status" } }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 4 });
    assert.match(String(written.getSessionFile()), new RegExp(`^${home}/\\.pi/sessions/setup/`));
    assert.deepEqual(LoreAgent.history(home, "setup"), [
      { text: "Let's set up my Lore.", owner: true },
      { text: "Welcome.", owner: false },
      { text: "College professor · Ada", owner: true }
    ]);
    const resumed = LoreAgent.sessionFor(home, "setup");
    const messages = resumed.buildSessionContext().messages;
    assert.equal(messages.length, 6);
    assert.deepEqual({ role: messages[5].role, toolCallId: messages[5].toolCallId, isError: messages[5].isError }, { role: "toolResult", toolCallId: "call-2", isError: true });
    assert.deepEqual(LoreAgent.tasks(home).map(({ kind, state, phase }) => ({ kind, state, phase })), [
      { kind: "setup", state: "stopped", phase: "Ready to resume" }
    ]);
    assert.equal(SessionManager.create(home).buildSessionContext().messages.length, 0);
    assert.equal(LoreAgent.sessionFor(home, "capture").buildSessionContext().messages.length, 0);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("typed task records survive relaunch and only unfinished known tasks are listed", async () => {
  const { LoreAgent, latestTaskRecord } = await import("../src/agent.mjs");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const write = (kind, data) => {
      const manager = SessionManager.create(home, join(home, ".pi", "sessions", kind));
      manager.appendCustomEntry("lore.task", data);
      manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Started." }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 1 });
      return manager;
    };
    const capture = write("capture", { version: 1, kind: "capture", title: "Capture a memory", state: "working", phase: "Review the capture" });
    capture.appendCustomEntry("lore.task", { version: 2, kind: "capture", title: "Injected", state: "working", phase: "Bad" });
    write("setup", { version: 1, kind: "setup", title: "Set up your Lore", state: "needs_you", phase: "Review your Lore shape" });
    write("publish", { version: 1, kind: "publish", title: "Publish from your Lore", state: "done", phase: "Finished" });
    assert.equal(latestTaskRecord(capture, "capture").title, "Capture a memory");
    assert.deepEqual(LoreAgent.tasks(home).map(({ kind, state }) => ({ kind, state })).sort((a, b) => a.kind.localeCompare(b.kind)), [
      { kind: "capture", state: "working" },
      { kind: "setup", state: "needs_you" }
    ]);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("an early-ended turn stays resumable until the owner starts over", async () => {
  const { LoreAgent, closingRecord, latestTaskRecord } = await import("../src/agent.mjs");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  assert.deepEqual(closingRecord("working", "setup", false), ["stopped", "Ready to resume"]);
  assert.deepEqual(closingRecord("working", "capture", false), ["stopped", "Ready to resume"]);
  assert.deepEqual(closingRecord("working", "setup", true), ["done", "Finished"]);
  assert.deepEqual(closingRecord("working", "publish", false), ["done", "Finished"]);
  assert.equal(closingRecord("needs_you", "setup", false), null);
  assert.equal(closingRecord(undefined, "setup", false), null);
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const live = LoreAgent.sessionFor(home, "setup");
    live.appendMessage({ role: "user", content: "Let's set up my Lore.", timestamp: 1 });
    live.appendCustomEntry("lore.task", { version: 1, kind: "setup", title: "Set up your Lore", state: "needs_you", phase: "Shape your Lore" });
    live.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "q1", name: "ask_user", arguments: {} }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 2 });
    const before = (await readFile(live.getSessionFile(), "utf8")).split("\n").filter(Boolean).length;
    assert.deepEqual(LoreAgent.tasks(home).map(({ kind, state }) => ({ kind, state })), [{ kind: "setup", state: "needs_you" }]);
    assert.equal((await readFile(live.getSessionFile(), "utf8")).split("\n").filter(Boolean).length, before, "listing must not write");
    const events = [];
    const idle = new LoreAgent(/** @type {LoreAgentOptions} */ ({ loreHome: home, emit: (event) => events.push(event) }), /** @type {never} */ (null), /** @type {never} */ (null), /** @type {never} */ (null));
    assert.deepEqual(idle.tasks().map(({ state, phase }) => ({ state, phase })), [{ state: "stopped", phase: "Ready to resume" }]);
    const resumedFile = LoreAgent.sessionFor(home, "setup").getSessionFile();
    assert.equal(resumedFile, live.getSessionFile(), "a resumable session continues the same file");
    const durable = join(home, "durable.txt");
    await writeFile(durable, "keep me");
    idle.restart("setup");
    const ended = SessionManager.continueRecent(home, join(home, ".pi", "sessions", "setup"));
    assert.deepEqual({ state: latestTaskRecord(ended, "setup").state, phase: latestTaskRecord(ended, "setup").phase }, { state: "done", phase: "Started over" });
    assert.deepEqual(idle.tasks(), []);
    assert.notEqual(LoreAgent.sessionFor(home, "setup").getSessionFile(), resumedFile);
    assert.equal(await readFile(durable, "utf8"), "keep me");
    assert.equal(events.at(-1).task.state, "done");
  } finally {
    await rm(home, { recursive: true });
  }
});

test("deploy is a task kind with its own session, title, and records", async () => {
  const { LoreAgent, latestTaskRecord } = await import("../src/agent.mjs");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const manager = LoreAgent.sessionFor(home, "deploy");
    manager.appendCustomEntry("lore.task", { version: 1, kind: "deploy", title: "Open your store", state: "needs_you", phase: "Payout, price, deploy" });
    manager.appendMessage({ role: "user", content: "Help me open my store.", timestamp: 1 });
    manager.appendMessage({ role: "assistant", content: [{ type: "text", text: "Let's start with a payout address." }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 });
    assert.match(String(manager.getSessionFile()), /\/\.pi\/sessions\/deploy\//);
    assert.equal(latestTaskRecord(manager, "deploy")?.phase, "Payout, price, deploy");
    assert.deepEqual(LoreAgent.tasks(home).map(({ kind, state }) => ({ kind, state })), [{ kind: "deploy", state: "needs_you" }]);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("the blueprint proposal boundary accepts only the CLI's bounded shape", async () => {
  const { validBlueprint } = await import("../src/agent.mjs");
  const { lore } = require("../src/state.cjs");
  const valid = {
    version: 1,
    name: "Ada",
    persona: "professor",
    organizing_axis: "knowledge",
    topic_outline: ["distributed systems"],
    focus_topics: ["consensus"],
    general_areas: [],
    storytelling: "Concise lectures"
  };
  assert.equal(validBlueprint(valid), true);
  for (const invalid of [
    { ...valid, version: 2 },
    { ...valid, persona: "wizard" },
    { ...valid, topic_outline: [] },
    { ...valid, source_path: "/etc/passwd" },
    { ...valid, storytelling: "x".repeat(1001) }
  ]) assert.equal(validBlueprint(invalid), false);
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    await lore(home, ["blueprint", "apply", "-"], JSON.stringify(valid));
    assert.equal(JSON.parse(await readFile(join(home, "blueprint", "blueprint.json"), "utf8")).name, "Ada");
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
    await assert.rejects(decide(directory, card, card, true), { message: /not drafted/ });
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
