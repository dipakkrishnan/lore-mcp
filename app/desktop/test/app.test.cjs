const assert = require("node:assert/strict");
const { access, constants, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } = require("node:fs/promises");
const { createServer } = require("node:http");
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

test("the agent may open only the pages the payments skill sends an owner to", () => {
  const { openable } = require("../src/state.cjs");
  assert.ok(openable("https://portal.cdp.coinbase.com/products/faucet"));
  assert.ok(openable("https://sepolia.basescan.org/address/0x1"));
  assert.ok(!openable("http://portal.cdp.coinbase.com/products/faucet"));
  assert.ok(!openable("https://portal.cdp.coinbase.com.evil.example/"));
  assert.ok(!openable("not a url"));
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
    // The packaged CLI runs from the Lore home, never from wherever the app was launched.
    await writeFile(bin, "#!/bin/sh\nprintf '{\"cwd\":\"%s\"}' \"$PWD\"\n", { mode: 0o755 });
    const { lore } = require("../src/state.cjs");
    assert.equal(JSON.parse(await lore(directory, [])).cwd, await realpath(directory));
  } finally {
    useRuntime();
    await rm(directory, { recursive: true });
  }
});

test("dev start refreshes the CLI that agent Bash gets from PATH", async () => {
  const pkg = JSON.parse(await readFile(join(__dirname, "../package.json"), "utf8"));
  assert.match(pkg.scripts.start, /^uv tool install --force --reinstall \.\.\/\.\. && /);
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

test("desktop Bash reads the agents' memories, never their credential files", async () => {
  const { bashSandboxPolicy } = await import("../src/agent.mjs");
  const home = await mkdtemp(join(tmpdir(), "lore-policy-"));
  try {
    const { allowRead } = bashSandboxPolicy(home, "setup").filesystem;
    for (const dir of [".claude/projects", ".codex/memories", ".codex/automations"]) assert.ok(allowRead.includes(join(homedir(), dir)), dir);
    for (const dir of [".claude", ".codex"]) assert.ok(!allowRead.includes(join(homedir(), dir)), `${dir} root, which holds auth.json and credentials`);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("dictation transcribes through the bundled whisper and leaves no audio behind", async () => {
  const { MAX_WAV_BYTES, transcribe } = require("../src/dictation.cjs");
  const dir = await mkdtemp(join(tmpdir(), "lore-dictation-"));
  const bin = join(dir, "whisper-cli");
  await writeFile(bin, '#!/bin/sh\ncp "$4" "$(dirname "$0")/seen.wav"\nprintf " [BLANK_AUDIO] Add the management layer first.\\n"\n', { mode: 0o755 });
  try {
    const wav = Buffer.alloc(44);
    wav.write("RIFF");
    const text = await transcribe({ bin, model: "model.bin", dir }, wav);
    assert.equal(text, "Add the management layer first.");
    assert.equal((await readFile(join(dir, "seen.wav"))).subarray(0, 4).toString(), "RIFF");
    assert.deepEqual((await require("node:fs/promises").readdir(dir)).filter((name) => name.endsWith(".wav") && name !== "seen.wav"), []);
    await assert.rejects(transcribe({ bin, model: "model.bin", dir }, Buffer.alloc(43)), /between 44 bytes and 20 MB/);
    await assert.rejects(transcribe({ bin, model: "model.bin", dir }, Buffer.alloc(MAX_WAV_BYTES + 1)), /between 44 bytes and 20 MB/);
  } finally {
    await rm(dir, { recursive: true });
  }
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

test("sessions persist per task, come back as a thread, and a cut-off tool call is closed out", async () => {
  const { LoreAgent } = await import("../src/agent.mjs");
  const { SessionManager } = await import("@earendil-works/pi-coding-agent");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    assert.deepEqual(LoreAgent.history(home, "setup"), []);
    const written = LoreAgent.sessionFor(home, "setup");
    written.appendMessage({ role: "user", content: "/skill:lore-onboard\n\nLet's set up my Lore.", timestamp: 1 });
    written.appendMessage({ role: "assistant", content: [{ type: "text", text: "Welcome." }, { type: "toolCall", id: "call-1", name: "ask_user", arguments: {} }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 2 });
    written.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "ask_user", content: [{ type: "text", text: JSON.stringify({ answers: { Persona: "College professor", Payout: "0x0c270534cfcecc9224edb903ef5dd70410d08166" } }) }], isError: false, timestamp: 3 });
    written.appendMessage({ role: "toolResult", toolCallId: "old-call", toolName: "ask_user", content: [{ type: "text", text: "old malformed result" }], isError: false, timestamp: 3 });
    written.appendMessage({ role: "toolResult", toolCallId: "m-1", toolName: "propose_memories", content: [{ type: "text", text: JSON.stringify({ entries: [{ title: "x", content: "y" }], note: "Call it the hiring lesson" }) }], isError: false, timestamp: 3 });
    written.appendMessage({ role: "toolResult", toolCallId: "m-2", toolName: "propose_memories", content: [{ type: "text", text: JSON.stringify({ saved: [{ id: 7, status: "inserted", title: "The hiring lesson" }] }) }], isError: false, timestamp: 3 });
    written.appendMessage({ role: "toolResult", toolCallId: "m-3", toolName: "propose_memories", content: [{ type: "text", text: JSON.stringify({ saved: [{ id: "7", title: "forged" }] }) }], isError: false, timestamp: 3 });
    written.appendMessage({ role: "assistant", content: [{ type: "toolCall", id: "call-2", name: "bash", arguments: { command: "lore status" } }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 4 });
    assert.match(String(written.getSessionFile()), new RegExp(`^${home}/\\.pi/sessions/setup/`));
    assert.deepEqual(LoreAgent.history(home, "setup"), [
      { text: "Let's set up my Lore.", owner: true },
      { text: "Welcome.", owner: false },
      { text: "College professor · Payout: 0x0c27…8166", owner: true },
      { text: "Call it the hiring lesson", owner: true },
      { text: "", owner: false, saved: [{ id: 7, status: "inserted", title: "The hiring lesson" }] }
    ]);
    const resumed = LoreAgent.sessionFor(home, "setup");
    const messages = resumed.buildSessionContext().messages;
    assert.equal(messages.length, 9);
    assert.deepEqual({ role: messages[8].role, toolCallId: messages[8].toolCallId, isError: messages[8].isError }, { role: "toolResult", toolCallId: "call-2", isError: true });
    assert.deepEqual(LoreAgent.tasks(home).map(({ kind, state, phase }) => ({ kind, state, phase })), [
      { kind: "setup", state: "stopped", phase: "Ready to resume" }
    ]);
    assert.equal(SessionManager.create(home).buildSessionContext().messages.length, 0);
    assert.equal(LoreAgent.sessionFor(home, "capture").buildSessionContext().messages.length, 0);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("a declined attended tool's plain-text result survives a resume, not just JSON-shaped ones", async () => {
  // Regression for a card response vanishing across a quit/relaunch (issue #256):
  // cloudflare_login, open_url, and store_secret answer in a plain English
  // sentence, not JSON, so history()'s JSON.parse-based reader dropped their
  // result on every replay, not just one lost to a quit-timing race.
  const { LoreAgent } = await import("../src/agent.mjs");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const written = LoreAgent.sessionFor(home, "deploy");
    written.appendMessage({ role: "user", content: "/skill:lore-enable-payments\n\nHelp me open my store.", timestamp: 1 });
    written.appendMessage({ role: "assistant", content: [{ type: "text", text: "Please sign in to the free hosting account in the browser." }, { type: "toolCall", id: "call-1", name: "cloudflare_login", arguments: {} }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "toolUse", timestamp: 2 });
    written.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "cloudflare_login", content: [{ type: "text", text: "The owner chose not to sign in to Cloudflare right now." }], isError: false, timestamp: 3 });
    written.appendMessage({ role: "toolResult", toolCallId: "call-err", toolName: "cloudflare_login", content: [{ type: "text", text: "wrangler crashed" }], isError: true, timestamp: 3 });
    written.appendMessage({ role: "toolResult", toolCallId: "call-2", toolName: "propose_price", content: [{ type: "text", text: JSON.stringify({ price_usd: 0.01 }) }], isError: false, timestamp: 4 });
    written.appendMessage({ role: "toolResult", toolCallId: "call-3", toolName: "propose_price", content: [{ type: "text", text: JSON.stringify({ price_usd: null }) }], isError: false, timestamp: 4 });
    assert.deepEqual(LoreAgent.history(home, "deploy"), [
      { text: "Help me open my store.", owner: true },
      { text: "Please sign in to the free hosting account in the browser.", owner: false },
      { text: "The owner chose not to sign in to Cloudflare right now.", owner: false },
      { text: "Price set: $0.01", owner: false },
      { text: "The owner declined to set a price.", owner: false }
    ]);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("a memory card saves exactly what the owner kept, through the CLI's private capture boundary", async () => {
  const { captureMemories } = require("../src/state.cjs");
  const { validSaved, validEntries } = await import("../src/agent.mjs");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    assert.equal(validEntries([]), true, "dropping every entry is a valid decision");
    assert.equal(validEntries([{ title: "t", content: "c", project: "p" }]), true);
    for (const bad of [[{ title: " ", content: "c" }], [{ title: "t", content: "" }], [{ title: "t".repeat(201), content: "c" }], [{ title: "t", content: "c", project: 3 }], [{ title: "t", content: "c", project: "p".repeat(201) }], "nope"]) {
      assert.equal(validEntries(bad), false, `main refuses ${JSON.stringify(bad).slice(0, 40)} before the CLI sees it`);
    }
    // The card's ceiling is the CLI's ceiling: what validEntries lets through, the CLI saves.
    assert.equal(validEntries([{ title: "t".repeat(200), content: "c" }]), true);
    assert.deepEqual(await captureMemories(home, []), []);
    const saved = await captureMemories(home, [{ title: "Hire management before rapid growth", content: "Add the management layer before the next ten engineers.", project: "team scaling" }]);
    assert.equal(validSaved(saved), true);
    assert.deepEqual(saved.map(({ status, title }) => ({ status, title })), [{ status: "added", title: "Hire management before rapid growth" }]);
    assert.equal((await readState(home)).library.counts.private, 1);
    await assert.rejects(captureMemories(home, [{ title: "", content: "x" }]));
    assert.equal((await readState(home)).library.counts.private, 1);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("draft for sale continues the capture thread instead of starting the publish agent cold", async () => {
  const { LoreAgent, latestTaskRecord } = await import("../src/agent.mjs");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const cold = LoreAgent.forkSession(home, "capture", "publish");
    assert.equal(cold.buildSessionContext().messages.length, 0, "no capture thread yet means a fresh publish session");
    assert.match(String(cold.getSessionFile()), /\/\.pi\/sessions\/publish\//);
    const capture = LoreAgent.sessionFor(home, "capture");
    capture.appendMessage({ role: "user", content: "/skill:lore-capture\n\nI learned to hire managers before scaling.", timestamp: 1 });
    capture.appendCustomEntry("lore.task", { version: 1, kind: "capture", title: "Capture a memory", state: "done", phase: "Finished" });
    capture.appendMessage({ role: "assistant", content: [{ type: "text", text: "Saved." }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 });
    const forked = LoreAgent.forkSession(home, "capture", "publish");
    assert.match(String(forked.getSessionFile()), /\/\.pi\/sessions\/publish\//);
    assert.notEqual(forked.getSessionFile(), capture.getSessionFile());
    assert.equal(forked.getHeader()?.parentSession, capture.getSessionFile());
    assert.deepEqual(forked.buildSessionContext().messages.map((message) => message.role), ["user", "assistant"], "the publish agent starts with the capture conversation");
    assert.equal(latestTaskRecord(forked, "publish"), null, "capture's records never count as publish state");
    assert.deepEqual(LoreAgent.tasks(home), []);
    assert.deepEqual(LoreAgent.history(home, "publish").map(({ text }) => text), ["I learned to hire managers before scaling.", "Saved."]);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("a memory the owner starts from is named to the agent by id and shown to the owner by title", async () => {
  const { LoreAgent } = await import("../src/agent.mjs");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const session = LoreAgent.sessionFor(home, "publish");
    session.appendMessage({ role: "user", content: '/skill:lore-publish\n\nHelp me publish something from my Lore, starting from "Tank cleanup crew".\n\n(For you only, not said by the owner: start from the memory with id 38. Call it by its title, never by its number.)', timestamp: 1 });
    session.appendMessage({ role: "assistant", content: [{ type: "text", text: "Reading it now." }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 });
    assert.deepEqual(LoreAgent.history(home, "publish"), [
      { text: 'Help me publish something from my Lore, starting from "Tank cleanup crew".', owner: true },
      { text: "Reading it now.", owner: false }
    ]);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("a follow-up typed into a finished thread keeps what was said; only Start over begins cold", async () => {
  const { LoreAgent, latestTaskRecord } = await import("../src/agent.mjs");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const finished = LoreAgent.sessionFor(home, "publish");
    finished.appendMessage({ role: "user", content: "/skill:lore-publish\n\nHelp me publish something from my Lore.", timestamp: 1 });
    finished.appendMessage({ role: "assistant", content: [{ type: "text", text: "Two drafts are ready to approve below." }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 });
    finished.appendCustomEntry("lore.task", { version: 1, kind: "publish", title: "Publish from your Lore", state: "done", phase: "Finished" });
    const followUp = LoreAgent.sessionFor(home, "publish");
    assert.notEqual(followUp.getSessionFile(), finished.getSessionFile(), "a finished thread is never appended to");
    assert.equal(followUp.getHeader()?.parentSession, finished.getSessionFile());
    assert.deepEqual(followUp.buildSessionContext().messages.map((message) => message.role), ["user", "assistant"], "the agent keeps the conversation it just had");
    assert.equal(latestTaskRecord(followUp, "publish")?.state, "done");
    await new Promise((resolve) => setTimeout(resolve, 10)); // the newest file wins by mtime, so the fork must land in a later millisecond than its source
    followUp.appendCustomEntry("lore.task", { version: 1, kind: "publish", title: "Publish from your Lore", state: "done", phase: "Started over" });
    assert.equal(LoreAgent.sessionFor(home, "publish").buildSessionContext().messages.length, 0, "Start over begins cold");
  } finally {
    await rm(home, { recursive: true });
  }
});

test("every tool that puts a card in front of the owner runs one at a time", async () => {
  // Pi runs a turn's tool calls in parallel unless a tool in it is sequential; two owner cards at once would overwrite each other in the app's single card slot.
  const source = await readFile(join(__dirname, "../src/agent.mjs"), "utf8");
  const owner = ["ask_user", "propose_memories", "propose_blueprint", "propose_price", "cloudflare_login", "open_url", "store_secret", "finish_task"];
  for (const name of owner) assert.match(source, new RegExp(`name: "${name}",\\s*executionMode: "sequential"`), `${name} must be sequential`);
});

test("a publish turn tells the agent where its drafts stand, and the owner never sees that line", async () => {
  const { LoreAgent, draftsAside } = await import("../src/agent.mjs");
  assert.match(draftsAside(0), /no drafts are waiting on the owner; anything you staged before was approved or skipped/);
  assert.match(draftsAside(1), /1 draft is still waiting/);
  assert.match(draftsAside(3), /3 drafts are still waiting/);
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const session = LoreAgent.sessionFor(home, "publish");
    session.appendMessage({ role: "user", content: `Help me publish something from my Lore.${draftsAside(0)}`, timestamp: 1 });
    session.appendMessage({ role: "assistant", content: [{ type: "text", text: "Pick a topic." }], api: "anthropic-messages", provider: "anthropic", model: "m", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 2 });
    assert.deepEqual(LoreAgent.history(home, "publish").map(({ text }) => text), ["Help me publish something from my Lore.", "Pick a topic."]);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("desktop prefers Opus 4.8 when Anthropic is available", async () => {
  const { MODELS } = await import("../src/agent.mjs");
  const { getBuiltinModel } = await import("@earendil-works/pi-ai/providers/all");
  assert.equal(MODELS[0], "anthropic/claude-opus-4-8");
  assert.equal(getBuiltinModel("anthropic", "claude-opus-4-8").id, "claude-opus-4-8");
});

test("Luna gives capture runs a short friendly name", async () => {
  const { nameRun } = await import("../src/agent.mjs");
  const models = {
    getAvailable: async () => [{ provider: "openai", id: "gpt-5.6-luna" }],
    completeSimple: async () => ({ content: [{ type: "text", text: "Pickleball for the Long Run\nextra" }], usage: { cost: { total: 0.0001 } } })
  };
  assert.deepEqual(await nameRun(/** @type {never} */ (models), "I want to reach 5.0 DUPR"), { title: "Pickleball for the Long Run", cost: 0.0001 });
  assert.deepEqual(await nameRun(/** @type {never} */ ({ getAvailable: async () => [] }), "anything"), { title: "", cost: 0 });
  const claudeOnly = { ...models, getAvailable: async () => [{ provider: "anthropic", id: "claude-sonnet-5" }] };
  assert.deepEqual(await nameRun(/** @type {never} */ (claudeOnly), "I want to reach 5.0 DUPR"), { title: "Pickleball for the Long Run", cost: 0.0001 }, "an owner signed in with Claude alone still gets a name");
});

test("API-key proof deletes rejected keys, not keys it could not check", async () => {
  const { LoreAgent } = await import("../src/agent.mjs");
  const replies = [
    { stopReason: "error", errorMessage: "fetch failed" },
    { stopReason: "error", errorMessage: '401 {"error":{"type":"authentication_error"}}' }
  ];
  const deleted = [];
  const agent = new LoreAgent(
    /** @type {LoreAgentOptions} */ ({ credentials: { list: async () => [], delete: async (provider) => deleted.push(provider) }, authPrompt: async () => "", authEvent: () => {} }),
    /** @type {never} */ ({ login: async () => {}, getAvailable: async () => [{}], completeSimple: async () => replies.shift() }),
    /** @type {never} */ (null),
    /** @type {never} */ (null)
  );
  await assert.rejects(agent.login("anthropic", "api_key", "key"), /fetch failed/);
  assert.deepEqual(deleted, []);
  await assert.rejects(agent.login("anthropic", "api_key", "key"), /not accepted/);
  assert.deepEqual(deleted, ["anthropic"]);
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

test("the bundled node is a shim that runs npm on Electron's embedded runtime", { skip: process.platform !== "darwin" }, async () => {
  const packaging = join(__dirname, "../packaging");
  const built = spawnSync(join(packaging, "node.sh"), { encoding: "utf8", timeout: 300_000 });
  assert.equal(built.status, 0, built.stderr);
  const bin = join(packaging, "out/node/bin");
  const node = join(bin, "node");
  await access(node, constants.X_OK);
  assert.equal((await readFile(node)).subarray(0, 2).toString(), "#!", "bin/node must be a shim, not a standalone binary");
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  // defaultApp keeps yargs-based CLIs (wrangler) reading the script from argv[1].
  const electron = spawnSync(node, ["-p", "process.versions.electron + ' ' + process.defaultApp"], { encoding: "utf8", env, timeout: 30_000 });
  assert.equal(electron.status, 0, electron.stderr);
  assert.equal(electron.stdout.trim(), `${require("electron/package.json").version} true`);
  const npm = spawnSync(join(bin, "npm"), ["--version"], { encoding: "utf8", env, timeout: 60_000 });
  assert.equal(npm.status, 0, npm.stderr);
  assert.match(npm.stdout, /^\d+\.\d+\.\d+/);
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

test("memory rename validates the id and title before any CLI call, and round-trips through the CLI", async () => {
  const { renameMemory } = require("../src/state.cjs");
  for (const bad of [0, -1, 1.5, "1", null]) await assert.rejects(renameMemory("/nonexistent", bad, "New title"), { message: /Invalid memory/ });
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    await assert.rejects(renameMemory(directory, 1, "   "), { message: /Title cannot be empty/ });
    await assert.rejects(renameMemory(directory, 999, "New title"), { message: /memory not found: 999/ });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("memory edit validates the id and content before any CLI call, and round-trips through the CLI", async () => {
  const { editMemory } = require("../src/state.cjs");
  for (const bad of [0, -1, 1.5, "1", null]) await assert.rejects(editMemory("/nonexistent", bad, "New content"), { message: /Invalid memory/ });
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    await assert.rejects(editMemory(directory, 1, "   "), { message: /Content cannot be empty/ });
    await assert.rejects(editMemory(directory, 999, "New content"), { message: /memory not found: 999/ });
    const { lore } = require("../src/state.cjs");
    const [{ id }] = JSON.parse(await lore(directory, ["capture", "apply", "-"], JSON.stringify([{ title: "Bullets", content: "First draft." }])));
    for (const content of ["-solo", "--json", "---\n- one\n- two"]) {
      assert.equal((await editMemory(directory, id, content)).content, content, "content that looks like an option must still be content");
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("report feedback validates before any CLI call, and round-trips adversarial content through the CLI to a stubbed relay, labeled desktop", async () => {
  const { reportFeedback } = require("../src/state.cjs");
  await assert.rejects(reportFeedback("/nonexistent", { title: "", email: "", description: "d" }), {
    message: /Title cannot be empty/
  });
  await assert.rejects(reportFeedback("/nonexistent", { title: "t", email: "", description: "   " }), {
    message: /Description cannot be empty/
  });

  const received = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received.push(JSON.parse(body));
      const payload = JSON.stringify({
        ok: true,
        issue_url: "https://github.com/dipakkrishnan/lore-mcp/issues/1",
        issue_number: 1
      });
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(payload);
    });
  });
  await new Promise((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const previousUrl = process.env.LORE_FEEDBACK_URL;
  try {
    process.env.LORE_FEEDBACK_URL = `http://127.0.0.1:${server.address().port}/report`;
    // A title/description that look like CLI flags must still arrive as
    // literal text — this is exactly the case --title=VALUE (not
    // --title VALUE) and stdin (not argv) exist to protect against.
    const receipt = await reportFeedback(directory, {
      title: "--json",
      email: "weird--flag@x.com",
      description: "--not-a-flag\nmulti line"
    });
    assert.deepEqual(receipt, {
      url: "https://github.com/dipakkrishnan/lore-mcp/issues/1",
      number: 1
    });
    assert.equal(received.length, 1);
    assert.equal(received[0].title, "--json");
    assert.equal(received[0].email, "weird--flag@x.com");
    assert.equal(received[0].description, "--not-a-flag\nmulti line");
    assert.equal(received[0].metadata.source, "desktop");
  } finally {
    if (previousUrl === undefined) delete process.env.LORE_FEEDBACK_URL;
    else process.env.LORE_FEEDBACK_URL = previousUrl;
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(directory, { recursive: true });
  }
});

test("report feedback omits --email entirely when none is given", async () => {
  const { reportFeedback } = require("../src/state.cjs");
  const received = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      received.push(JSON.parse(body));
      const payload = JSON.stringify({
        ok: true,
        issue_url: "https://github.com/dipakkrishnan/lore-mcp/issues/2",
        issue_number: 2
      });
      response.writeHead(201, { "Content-Type": "application/json" });
      response.end(payload);
    });
  });
  await new Promise((resolveListening) => server.listen(0, "127.0.0.1", resolveListening));
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const previousUrl = process.env.LORE_FEEDBACK_URL;
  try {
    process.env.LORE_FEEDBACK_URL = `http://127.0.0.1:${server.address().port}/report`;
    await reportFeedback(directory, { title: "No email", email: "  ", description: "details" });
    assert.equal(received[0].email, null);
  } finally {
    if (previousUrl === undefined) delete process.env.LORE_FEEDBACK_URL;
    else process.env.LORE_FEEDBACK_URL = previousUrl;
    await new Promise((resolveClose) => server.close(resolveClose));
    await rm(directory, { recursive: true });
  }
});

test("a CLI refusal explained over several lines reaches the owner as its Reason line", async () => {
  const { lore } = require("../src/state.cjs");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const schedule = () => lore(home, ["profile", join(home, "automation", "profile.json")]);
  try {
    // No profile yet: a one-line refusal comes through as it is.
    await assert.rejects(schedule(), { message: /No such file|profile\.json/ });
    // A rhythm saved without a model: the CLI keeps the profile and explains over
    // several lines; the owner hears the Reason line, not "Then run: env ...".
    await mkdir(join(home, "automation"), { recursive: true });
    await writeFile(join(home, "automation", "profile.json"), JSON.stringify({ executor: "", cadence: "daily", hour: 21 }));
    await assert.rejects(schedule(), (error) => /^'' is not a valid Agent$/.test(error.message));
    assert.deepEqual((await readState(home)).setup.schedule, { installed: false, executor: null, cadence: null, hour: null });
  } finally {
    await rm(home, { recursive: true });
  }
});

test("the price action refuses anything but a positive number, and round-trips through the CLI", async () => {
  const { setPrice, readState } = require("../src/state.cjs");
  // Rejected before any CLI call: "/nonexistent" would fail loudly otherwise.
  for (const bad of [0, -1, NaN, Infinity, "0.01", null, undefined]) {
    await assert.rejects(setPrice("/nonexistent", bad), { message: /A price has to be a number above zero/ }, String(bad));
  }
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    assert.equal((await readState(directory)).pricing.publication_usd, null);
    await setPrice(directory, 0.25);
    assert.equal((await readState(directory)).pricing.publication_usd, 0.25);
    // Sub-cent prices are legal all the way down to the deploy floor.
    await setPrice(directory, 0.000001);
    assert.equal((await readState(directory)).pricing.publication_usd, 0.000001);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("propose_price is a live tool, and the agent is told not to price by hand", async () => {
  // A custom tool missing from `tools:` is defined but inactive, which is the
  // silent way this wiring breaks.
  const source = await readFile(join(__dirname, "../src/agent.mjs"), "utf8");
  const active = source.match(/tools: \[([^\]]*)\]/)[1];
  assert.match(active, /"propose_price"/, "propose_price must be in the active tool list");
  assert.match(source, /this\.#priceTool\(\)/, "and registered as a custom tool");
  assert.match(source, /call propose_price and never run a price command yourself/);
});
