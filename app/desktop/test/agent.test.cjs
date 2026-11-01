// The scripted agent: turns, sessions, readings, check-ins, routines and the owner's agents, with pi's stand-in model.
// APP-248: split from app.test.cjs so node --test runs the desktop unit tests in parallel, one process per file.
const assert = require("node:assert/strict");
const { existsSync } = require("node:fs");
const { access, constants, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, stat, symlink, writeFile } = require("node:fs/promises");
const { createServer } = require("node:http");
const { homedir, tmpdir, userInfo } = require("node:os");
const { basename, dirname, join, sep } = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn, spawnSync } = require("node:child_process");
const { test } = require("node:test");
// Each test process gets its own scratch store, keys and CLI runtime; required before anything loads ../src/state.cjs.
const { CLI, readState } = require("../support/scratch.cjs");
const { scriptedAgent, until } = require("../support/scripted.cjs");

test("an agent's question never carries the app's full-text block to the owner", async () => {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  /** @type {OwnerQuestion[][]} */
  const shown = [];
  const { agent, faux, loreHome } = await scriptedAgent({ askUser: async (questions) => { shown.push(questions); return {}; } });
  const question = { question: "Pick one", header: "Pick", options: [{ label: "A", description: "a", injected: true }], multiSelect: false, detail: "planted text" };
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("ask_user", { questions: [question] }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Done.")
  ]);
  try {
    await agent.prompt("Ask me", "capture");
    assert.equal(shown.length, 0, "the schema refuses a field an ask_user card does not have");
    // And were one to get past it, only the card's own fields go on.
    const { asked } = await import("../src/agent.mjs");
    assert.deepEqual(asked([/** @type {OwnerQuestion} */ (question)]), [{ question: "Pick one", header: "Pick", options: [{ label: "A", description: "a" }], multiSelect: false }]);
    assert.ok(!JSON.stringify(shown).includes("planted text"));
  } finally {
    agent.dispose();
    await rm(loreHome, { recursive: true, force: true });
  }
});

test("a reply reads the same from Anthropic and OpenAI: paragraphs, and OpenAI's preview dropped once its final answer lands", async () => {
  const { LoreAgent } = await import("../src/agent.mjs");
  const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const luna = { api: "openai-codex-responses", provider: "openai-codex", model: "gpt-5.6-luna", usage };
  const claude = { api: "anthropic-messages", provider: "anthropic", model: "claude-opus-5-5", usage };
  /** @param {string} id @param {"commentary" | "final_answer"} phase */
  const signed = (id, phase) => JSON.stringify({ v: 1, id, phase });
  try {
    const written = LoreAgent.sessionFor(home, "capture");
    written.appendMessage({ role: "user", content: "/skill:lore-capture\n\nwhat do you think will sell the best", timestamp: 1 });
    // Recorded from GPT-5.6 Luna: a preview before a tool call stands alone, then a preview and the final answer that repeats it.
    written.appendMessage({ role: "assistant", content: [{ type: "text", text: "I’m grounding the draft in your Deep Review case study.", textSignature: signed("msg_1", "commentary") }, { type: "toolCall", id: "call-1", name: "bash", arguments: { command: "lore search x" } }], ...luna, stopReason: "toolUse", timestamp: 2 });
    written.appendMessage({ role: "toolResult", toolCallId: "call-1", toolName: "bash", content: [{ type: "text", text: "[]" }], isError: false, timestamp: 3 });
    written.appendMessage({ role: "assistant", content: [{ type: "thinking", thinking: "**Drafting readiness confirmation sentence**" }, { type: "text", text: "The publication draft is ready for your approval below.", textSignature: signed("msg_2", "commentary") }, { type: "text", text: "The publication draft is waiting for your approval.", textSignature: signed("msg_3", "final_answer") }], ...luna, stopReason: "stop", timestamp: 4 });
    // Claude sends no phase; two text blocks are two paragraphs.
    written.appendMessage({ role: "user", content: "I mean to sell", timestamp: 5 });
    written.appendMessage({ role: "assistant", content: [{ type: "text", text: "Got it." }, { type: "text", text: "Choose Draft for sale on the saved memory." }], ...claude, stopReason: "stop", timestamp: 6 });
    assert.deepEqual(LoreAgent.history(home, "capture").map(({ text }) => text), [
      "what do you think will sell the best",
      "I’m grounding the draft in your Deep Review case study.",
      "The publication draft is waiting for your approval.",
      "I mean to sell",
      "Got it.\n\nChoose Draft for sale on the saved memory."
    ]);
  } finally {
    await rm(home, { recursive: true });
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
      { kind: "setup", state: "stopped", phase: "Reply to keep going" }
    ]);
    assert.equal(SessionManager.create(home).buildSessionContext().messages.length, 0);
    assert.equal(LoreAgent.sessionFor(home, "capture").buildSessionContext().messages.length, 0);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("a declined attended tool's plain-text result survives a resume, not just JSON-shaped ones", async () => {
  // Regression for a card response vanishing across a quit/relaunch (issue #256):
  // cloudflare_login and open_url answer in a plain English
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
    const halfway = "The deploy did not finish: Lore couldn't switch your store's network.\nYour store may be half-updated: it now pays 0x7777 on its old network. Open your store again to finish.";
    written.appendMessage({ role: "toolResult", toolCallId: "call-4", toolName: "open_store", content: [{ type: "text", text: halfway }], isError: false, timestamp: 5 });
    written.appendMessage({ role: "toolResult", toolCallId: "call-5", toolName: "save_profile", content: [{ type: "text", text: "The owner kept their profile as it was." }], isError: false, timestamp: 6 });
    assert.deepEqual(LoreAgent.history(home, "deploy"), [
      { text: "Help me open my store.", owner: true },
      { text: "Please sign in to the free hosting account in the browser.", owner: false },
      { text: "The owner chose not to sign in to Cloudflare right now.", owner: false },
      { text: "Price set: $0.01", owner: false },
      { text: "The owner declined to set a price.", owner: false },
      { text: halfway, owner: false },
      { text: "The owner kept their profile as it was.", owner: false }
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

test("desktop prefers Anthropic, and every model it asks for is one Pi knows", async () => {
  const { MODELS } = await import("../src/agent.mjs");
  const { getBuiltinModel } = await import("@earendil-works/pi-ai/providers/all");
  assert.match(MODELS[0], /^anthropic\//);
  for (const model of MODELS) {
    const [provider, ...id] = model.split("/");
    assert.equal(getBuiltinModel(provider, id.join("/"))?.id, id.join("/"), model);
  }
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
  await assert.rejects(agent.login("anthropic", "api_key", "key"), /^Error: Lore could not check that key right now\. Try again\.$/);
  assert.deepEqual(deleted, []);
  await assert.rejects(agent.login("anthropic", "api_key", "key"), /not accepted/);
  assert.deepEqual(deleted, ["anthropic"]);
});

test("a browser sign-in left waiting stops on cancel or a new sign-in, and takes its pasted-URL field with it", async () => {
  const { LoreAgent } = await import("../src/agent.mjs");
  /** @type {AbortSignal[]} */
  const fields = [];
  /** @type {unknown[]} */
  const events = [];
  const models = {
    /** @param {string} _provider @param {string} _type @param {import("@earendil-works/pi-ai").AuthInteraction} interaction */
    login: (_provider, _type, interaction) => new Promise((_resolve, reject) => {
      void interaction.prompt({ type: "manual_code", message: "", signal: new AbortController().signal }).catch(() => {});
      interaction.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })
  };
  const agent = new LoreAgent(
    /** @type {LoreAgentOptions} */ ({ credentials: { list: async () => [] }, authPrompt: async (prompt) => { fields.push(/** @type {AbortSignal} */ (prompt.signal)); return new Promise(() => {}); }, authEvent: (event) => void events.push(event) }),
    /** @type {never} */ (models),
    /** @type {never} */ (null),
    /** @type {never} */ (null)
  );
  const first = agent.login("anthropic", "oauth", undefined);
  const second = agent.login("openai-codex", "oauth", undefined);
  await assert.rejects(first, /^Error: Sign-in stopped\.$/);
  assert.equal(fields[0].aborted, true, "the closed tab's sign-in lets go of its field, so its callback port frees");
  agent.cancelLogin();
  await assert.rejects(second, /^Error: Sign-in stopped\.$/);
  assert.equal(fields[1].aborted, true);

  // Cancelled while the flow is still starting its callback server: the field it asks for afterwards refuses at once.
  /** @type {Promise<string> | undefined} */
  let late;
  models.login = (_provider, _type, interaction) => new Promise((_resolve, reject) => {
    interaction.signal?.addEventListener("abort", () => {
      interaction.notify({ type: "auth_url", url: "https://claude.ai/oauth/authorize" });
      late = interaction.prompt({ type: "manual_code", message: "", signal: new AbortController().signal });
      reject(new Error("aborted"));
    }, { once: true });
  });
  const starting = agent.login("anthropic", "oauth", undefined);
  agent.cancelLogin();
  await assert.rejects(starting, /^Error: Sign-in stopped\.$/);
  await assert.rejects(/** @type {Promise<string>} */ (late));
  assert.equal(fields.length, 2, "no field is shown for a sign-in already stopped");
  assert.deepEqual(events, [], "nor is its browser tab opened");
});

test("a refused sign-in refresh asks the owner to sign in again; no model error ever reaches the thread", async (t) => {
  const { LoreAgent, latestTaskRecord } = await import("../src/agent.mjs");
  const { DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const logged = [];
  t.mock.method(console, "error", (detail) => logged.push(String(detail)));
  const refusals = {
    expired: async () => new Response('{"error": "invalid_grant", "error_description": "Refresh token expired"}', { status: 400 }),
    offline: async () => { throw new TypeError("fetch failed"); }
  };
  for (const [refusal, fetch] of Object.entries(refusals)) {
    t.mock.method(globalThis, "fetch", fetch);
    const home = await mkdtemp(join(tmpdir(), "lore-desktop-"));
    /** @type {Record<string, import("@earendil-works/pi-ai").Credential>} */
    const stored = { anthropic: { type: "oauth", access: "old", refresh: "old", expires: Date.now() - 1000 } };
    const credentials = {
      read: async (id) => stored[id],
      list: async () => Object.keys(stored).map((providerId) => ({ providerId, type: stored[providerId].type })),
      modify: async (id, change) => (await change(stored[id])) ?? stored[id],
      delete: async (id) => { delete stored[id]; }
    };
    const events = [];
    try {
      // Pi retries a dropped connection with backoff; once is the same answer, faster.
      const settings = SettingsManager.inMemory({ retry: { enabled: false } });
      const resources = new DefaultResourceLoader({ cwd: home, agentDir: join(home, ".pi"), settingsManager: settings, noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true });
      await resources.reload();
      const agent = new LoreAgent(
        /** @type {LoreAgentOptions} */ ({ loreHome: home, credentials, emit: (event) => events.push(event) }),
        await ModelRuntime.create({ credentials: /** @type {never} */ (credentials) }),
        settings,
        resources
      );
      await agent.prompt("Let's set up my Lore", "setup");
      const said = events.filter((event) => event.type === "message").map((event) => event.text);
      const state = latestTaskRecord(SessionManager.continueRecent(home, join(home, ".pi", "sessions", "setup")), "setup").state;
      if (refusal === "expired") {
        assert.deepEqual(said, []);
        assert.deepEqual(events.filter((event) => event.type === "signed-out"), [{ type: "signed-out", text: "Your Claude sign-in expired. Sign in again to keep going." }]);
        assert.deepEqual(stored, {}, "the refused sign-in is dropped");
        assert.equal(state, "needs_you");
      } else {
        assert.deepEqual(said, ["Lore's model did not answer. Try again."]);
        assert.equal(events.some((event) => event.type === "signed-out"), false);
        assert.equal(stored.anthropic?.refresh, "old", "a dropped connection keeps the sign-in");
        assert.equal(state, "stopped");
      }
      assert.match(logged.at(-1), /^OAuth refresh failed for anthropic/, "the detail goes to the log");
    } finally {
      await rm(home, { recursive: true });
    }
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
  assert.deepEqual(closingRecord("working", "setup", false), ["stopped", "Reply to keep going"]);
  assert.deepEqual(closingRecord("working", "capture", false), ["stopped", "Reply to keep going"]);
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
    assert.deepEqual(idle.tasks().map(({ state, phase }) => ({ state, phase })), [{ state: "stopped", phase: "Reply to keep going" }]);
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

test("a capture that saves closes as done even when the agent never calls finish_task, and its job row does not contradict itself", async () => {
  // Issue #247: a capture whose propose_memories save succeeded still showed as
  // Unfinished/Stopped, and its Recent-runs row paired a Done chip with a summary
  // that said "Stopped before finishing" — because closing relied solely on the
  // model remembering to call finish_task. savedCompletion is the safety net
  // (#memoriesTool marks the turn complete the moment the owner's keep lands),
  // and jobOutcome is what stops the two trackers from disagreeing about the
  // same event: an uncompleted turn must never report "succeeded".
  const { closingRecord, jobOutcome, savedCompletion } = await import("../src/agent.mjs");
  assert.equal(savedCompletion({ saved: [{ id: 7, status: "added", title: "The hiring lesson" }] }), true);
  assert.equal(savedCompletion({ saved: [] }), false, "dropping every entry is not a completion");
  assert.equal(savedCompletion({ entries: [{ title: "t", content: "c" }], note: "call it something else" }), false, "a correction round is not a completion");
  assert.equal(savedCompletion(null), false);
  assert.equal(savedCompletion("nope"), false);
  assert.equal(savedCompletion([{ saved: [] }]), false, "an array is never a real outcome");
  // A capture that saved (savedCompletion true) closes the same way finish_task does.
  assert.deepEqual(closingRecord("working", "capture", true), ["done", "Finished"]);
  // Without a save or finish_task, it stays resumable, exactly as before.
  assert.deepEqual(closingRecord("working", "capture", false), ["stopped", "Reply to keep going"]);
  // The job row: done only when the save is known to have finished; otherwise the
  // outcome is unknown ("incomplete", Recent runs' "Unfinished"), never a quiet
  // "succeeded" paired with a summary that says the opposite.
  assert.deepEqual(jobOutcome(true), ["succeeded", "captured"]);
  assert.deepEqual(jobOutcome(false), ["incomplete", "stopped"]);
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
    // The old marker, which the agent's shell could set itself, no longer opens the gate.
    const forged = spawnSync("uv", ["run", "lore", "publication", "decide"], {
      cwd: join(__dirname, "../../.."),
      env: { ...process.env, LORE_HOME: directory, NO_COLOR: "1", LORE_ATTENDED_SURFACE: "desktop", LORE_ATTENDED_KEY: "guess" },
      input: JSON.stringify({ candidate: card, approve: true }),
      encoding: "utf8"
    });
    assert.equal(forged.status, 1);
    assert.match(forged.stderr, /only from the Lore desktop app/);
    await assert.rejects(decide(directory, card, card, true), { message: /not drafted/ });
    const state = await readState(directory);
    assert.equal(state.publications.counts.active, 0);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("new free parts for a live piece are staged by the agent and decided only by Electron main", async () => {
  const { lore, decide, extrasCandidates, decideExtras } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  /** @param {string[]} args @param {string} input */
  const piped = (args, input) => spawnSync("uv", ["run", "lore", ...args], {
    cwd: join(__dirname, "../../.."),
    env: { ...process.env, LORE_HOME: directory, NO_COLOR: "1" },
    input,
    encoding: "utf8"
  });
  const card = { title: "Price low", teaser: "How to set a first price.", content: "Price low first.", kind: /** @type {const} */ ("claim"), topic: "pricing", provenance: [1] };
  const extras = { publication_id: 1, sample: "We started at a dollar.", useful_if: "you price an API", not_useful_if: "" };
  try {
    await lore(directory, ["capture", "apply", "-"], JSON.stringify([{ title: "Pricing", content: "Price low first.", project: "pricing" }]));
    assert.equal(piped(["publication", "extras", "draft", "-"], JSON.stringify([extras])).status, 1, "nothing is on sale yet");
    await lore(directory, ["publication", "draft", "-"], JSON.stringify([card]));
    await decide(directory, card, card, true);
    await lore(directory, ["publication", "extras", "draft", "-"], JSON.stringify([extras]));
    const [staged] = await extrasCandidates(directory);
    assert.deepEqual(staged.extras, extras);
    assert.equal(staged.piece.title, "Price low");
    assert.equal(staged.piece.sample, "");
    const refused = piped(["publication", "extras", "decide"], JSON.stringify({ extras, approve: true }));
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /only from the Lore desktop app/);
    await decideExtras(directory, extras, { ...extras, sample: "The owner's excerpt." }, true);
    assert.deepEqual(await extrasCandidates(directory), []);
    const listed = await lore(directory, ["publication", "list"]);
    assert.match(listed, /free sample: The owner's excerpt\./);
    assert.equal((await readState(directory)).publications.counts.active, 1, "the same piece, not a new one");
    await assert.rejects(decideExtras(directory, extras, extras, true), { message: /not drafted/ });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("asked in chat to push the store, the agent can't: only the store's own thread has the store's tools (APP-229)", async () => {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  /** @type {OpenStore[]} */
  const opened = [];
  const { agent, faux, loreHome } = await scriptedAgent({ openStore: async (store) => { opened.push(store); return "The store is deployed."; } });
  /** @type {string[]} */
  const results = [];
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("open_store", { network: "real" }), { stopReason: "toolUse" }),
    (context) => {
      for (const message of context.messages) {
        if (message.role === "toolResult") results.push(message.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
      }
      return fauxAssistantMessage("I can't update your store from here.");
    }
  ]);
  try {
    await agent.prompt("Push my store", "publish");
    assert.deepEqual(opened, []);
    assert.match(results[0], /not found/i);
  } finally {
    agent.dispose();
    await rm(loreHome, { recursive: true, force: true });
  }
});

test("an app that brings something new in is read through once; one that brings nothing is not", () => {
  const { worthReading } = require("../src/reading.cjs");
  const apps = [{ id: "granola", name: "Granola", item: "meeting" }, { id: "medium", name: "Medium", item: "story" }];
  assert.deepEqual(worthReading({ name: "granola-1", connector: "granola", added: 23 }, apps), { name: "granola-1", label: "Granola", item: "meeting", added: 23, title: "Lore read your Granola meetings", phase: "Reading your Granola meetings", by: { kind: "app", id: "granola-1", label: "Granola", mark: "granola" } }, "worded once, for Today and the notification, and the app on record for what it brings");
  assert.equal(worthReading({ name: "granola-1", connector: "granola", added: 0 }, apps), null);
  assert.equal(worthReading({ name: "granola-1", connector: "granola" }, apps), null, "a CLI older than AUT-005 says nothing came in");
  assert.equal(worthReading({ name: "codex", connector: null, added: 3 }, apps), null, "the agents' own memories are the schedule's");
});

test("a reading runs quietly, says what it is doing on Today, and hands back what it wrote", async () => {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  /** @type {Array<[Reading, ReadingReport]>} */
  const handed = [];
  const { agent, faux, events, loreHome } = await scriptedAgent({ memoriesReady: async (reading, report) => { handed.push([reading, report]); } });
  /** @type {string[]} */
  const asked = [];
  const report = { read: 23, memories: [{ file: "receipts-beat-surveys.md", worth_selling: true, why: "measured on ten buyers" }] };
  faux.setResponses([
    (context) => {
      const first = context.messages.find((message) => message.role === "user");
      asked.push(typeof first.content === "string" ? first.content : first.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
      return fauxAssistantMessage(fauxToolCall("memories_ready", report), { stopReason: "toolUse" });
    },
    fauxAssistantMessage("Done.")
  ]);
  try {
    agent.synthesize({ name: "granola-1", label: "Granola", item: "meeting", added: 23, title: "Lore read your Granola meetings", phase: "Reading your Granola meetings" });
    await until(() => handed.length === 1);
    assert.deepEqual(handed, [[{ name: "granola-1", label: "Granola", item: "meeting", added: 23, title: "Lore read your Granola meetings", phase: "Reading your Granola meetings" }, report]]);
    assert.match(asked[0], /lore-synthesize/);
    assert.match(asked[0], /23 new Granola meetings/);
    assert.match(asked[0], /"granola-1"/);
    assert.ok(asked[0].includes(JSON.stringify(join(loreHome, "memories"))));
    assert.ok(!events.some((event) => event.type === "working"), "the owner's composer never locks for a reading");
    const records = events.flatMap((event) => (event.type === "task" ? [event.task] : []));
    assert.deepEqual(records.map((record) => [record.kind, record.state, record.phase]), [["synthesize", "working", "Reading your Granola meetings"], ["synthesize", "done", "Finished"]]);
    assert.deepEqual(agent.tasks(), [], "a finished reading is no unfinished thread");
  } finally {
    await rm(loreHome, { recursive: true, force: true });
  }
});

test("the owner's turn stops a reading, and the reading starts over once the owner is done", async () => {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  /** @type {Array<ReadingReport & {added: number}>} */
  const handed = [];
  const { agent, faux, loreHome } = await scriptedAgent({ memoriesReady: async (reading, report) => { handed.push({ ...report, added: reading.added }); } });
  let reading = 0;
  faux.setResponses([
    // The first reading runs until it is told to stop.
    (_context, options) => new Promise((resolve) => {
      reading++;
      options?.signal?.addEventListener("abort", () => resolve(fauxAssistantMessage("", { stopReason: "aborted" })), { once: true });
    }),
    fauxAssistantMessage("Kept that."),
    fauxAssistantMessage(fauxToolCall("memories_ready", { read: 5, memories: [] }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Done.")
  ]);
  try {
    agent.synthesize({ name: "granola-1", label: "Granola", item: "meeting", added: 3 });
    await until(() => reading === 1);
    // Two more meetings arrive while the first three are being read: one reading covers all five.
    agent.synthesize({ name: "granola-1", label: "Granola", item: "meeting", added: 2 });
    await agent.prompt("I learned to hire managers before scaling.", "capture");
    await until(() => handed.length === 1);
    assert.deepEqual(handed, [{ read: 5, memories: [], added: 5 }], "the stopped reading never handed anything back");
    assert.equal(faux.getPendingResponseCount(), 0);
  } finally {
    await rm(loreHome, { recursive: true, force: true });
  }
});

test("what a reading wrote before it gave way to the owner is still handed back, and nothing the owner's turn wrote is", async () => {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  /** @type {Array<[ReadingReport, string[]]>} */
  const handed = [];
  const { agent, faux, loreHome } = await scriptedAgent({ memoriesReady: async (_reading, report, wrote) => { handed.push([report, wrote]); } });
  const folder = join(loreHome, "memories");
  await mkdir(join(folder, "work"), { recursive: true });
  await writeFile(join(folder, "kept.md"), "from before");
  let reading = 0;
  faux.setResponses([
    // The first run writes a memory, then is stopped before it can say so.
    (_context, options) => new Promise((resolve) => {
      require("node:fs").writeFileSync(join(folder, "work", "travel.md"), "how I travel");
      reading++;
      options?.signal?.addEventListener("abort", () => resolve(fauxAssistantMessage("", { stopReason: "aborted" })), { once: true });
    }),
    () => {
      require("node:fs").writeFileSync(join(folder, "owner.md"), "the owner's own");
      return fauxAssistantMessage("Kept that.");
    },
    // Run again, it finds that memory already there and says it wrote nothing.
    fauxAssistantMessage(fauxToolCall("memories_ready", { read: 4, memories: [] }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Done."),
    // A run that ends without saying anything still hands back what it wrote.
    () => {
      require("node:fs").writeFileSync(join(folder, "seats.md"), "window seats");
      return fauxAssistantMessage("I wrote it.");
    }
  ]);
  try {
    agent.synthesize({ name: "agent-1", label: "Grok", item: "save", added: 4, title: "Grok saved 4 things to Lore", phase: "Reading what Grok saved", by: { kind: "agent", id: "agent-1", label: "Grok", mark: "grok" } });
    await until(() => reading === 1);
    await agent.prompt("I learned to hire managers before scaling.", "capture");
    await until(() => handed.length === 1);
    assert.deepEqual(handed, [[{ read: 4, memories: [] }, [join(folder, "work", "travel.md")]]]);
    agent.synthesize({ name: "granola-1", label: "Granola", item: "meeting", added: 1, title: "Lore read your Granola meetings", phase: "Reading your Granola meetings", by: { kind: "app", id: "granola-1", label: "Granola", mark: "granola" } });
    await until(() => handed.length === 2);
    assert.deepEqual(handed[1], [{ read: 1, memories: [] }, [join(folder, "seats.md")]]);
  } finally {
    await rm(loreHome, { recursive: true, force: true });
  }
});

test("a reading lands as Today lists it: only stored memories, work never for sale, and plain words", async () => {
  const { landed, announcement } = require("../src/reading.cjs");
  const folder = "/Users/owner/.lore/memories";
  /** @param {number} id @param {string} file @param {string} [status] */
  const memory = (id, file, status = "private") => ({ id, title: `Topic ${id}`, content: "", project: "", source: "automation", source_path: `${folder}/${file}`, status, updated_at: "" });
  const stored = [memory(1, "receipts.md"), memory(2, "work/launch-review.md"), memory(3, "dropped.md", "discarded")];
  const run = landed(
    { name: "granola-1", label: "Granola", item: "meeting", added: 23, title: "Lore read your Granola meetings", phase: "Reading your Granola meetings" },
    {
      read: 23,
      memories: [
        { file: "receipts.md", worth_selling: true, why: "ten paying buyers" },
        { file: "work/launch-review.md", worth_selling: true, why: "names the client" },
        { file: "receipts.md", worth_selling: true, why: "again" },
        { file: "dropped.md", worth_selling: false, why: "" },
        { file: "never-synced.md", worth_selling: false, why: "" },
        { file: "../../.ssh/config", worth_selling: false, why: "" }
      ]
    },
    stored,
    folder
  );
  assert.deepEqual(run.memories, [
    { id: 1, title: "Topic 1", sell: true, work: false, why: "ten paying buyers" },
    { id: 2, title: "Topic 2", sell: false, work: true, why: "names the client" }
  ]);
  assert.equal(run.seen, false);
  assert.deepEqual(announcement(run), { title: "Lore read your Granola meetings", body: "2 new memories. 1 looks worth selling." });
  assert.deepEqual(announcement({ ...run, read: 1, memories: [run.memories[1]] }), { title: "Lore read your Granola meetings", body: "1 new memory. They stay private on this Mac." });
});

test("the memories the owner has seen are kept across relaunches, from where Lore began keeping track", async () => {
  const { Seen, seenIds } = require("../src/reading.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-seen-"));
  const file = join(directory, "memories-seen.json");
  assert.deepEqual(await new Seen(file).read(12), { since: 12, arrivals: [] }, "a library from before is never all new at once");
  const seen = new Seen(file);
  await Promise.all([seen.add([13, 14]), seen.add([15]), seen.add([3])]);
  assert.deepEqual(await new Seen(file).read(99), { since: 12, arrivals: [13, 14, 15] }, "two reports at once both land; an old memory needs no record; a relaunch keeps since");
  await writeFile(file, "{not json");
  assert.deepEqual(await new Seen(file).read(20), { since: 20, arrivals: [] }, "a damaged file starts over from now");
  assert.deepEqual(seenIds([1, 2]), [1, 2]);
  for (const bad of [[], [0], [1.5], ["1"], null, "1", Array.from({ length: 501 }, (_, i) => i + 1)]) assert.throws(() => seenIds(bad), /Invalid memories/);
  await rm(directory, { recursive: true });
});

test("the dock counts new memories until the owner has seen them, and Clear empties Today", async () => {
  const { Ready } = require("../src/reading.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-ready-"));
  /** @type {number[]} */
  const badges = [];
  const ready = new Ready(join(directory, "memories-ready.json"), (count) => badges.push(count));
  /** @param {number} count @returns {ReadyRun} */
  const run = (count) => ({ title: "Lore read your Granola meetings", read: 9, memories: Array.from({ length: count }, (_, id) => ({ id, title: "t", sell: false, work: false, why: "" })), at: "", seen: false });
  try {
    assert.deepEqual(await ready.runs(), [], "nothing read yet");
    await ready.add(run(6));
    await ready.add(run(2));
    assert.deepEqual(badges, [6, 8]);
    await ready.seen();
    assert.equal(badges.at(-1), 0);
    await ready.add(run(3));
    assert.equal(badges.at(-1), 3, "only what arrived since the owner looked");
    assert.deepEqual((await ready.runs()).map((kept) => kept.memories.length), [3, 2, 6]);
    await new Ready(join(directory, "memories-ready.json"), (count) => badges.push(count)).show();
    assert.equal(badges.at(-1), 3, "a relaunch puts the badge back");
    await ready.clear();
    assert.deepEqual([await ready.runs(), badges.at(-1)], [[], 0]);
    await writeFile(join(directory, "memories-ready.json"), JSON.stringify([{ label: "Granola", item: "meeting", read: 2, memories: [], at: "", seen: true }]));
    assert.equal((await ready.runs())[0].title, "Lore read your Granola meetings", "a run kept by 0.1.14 is titled as it was then");
    await writeFile(join(directory, "memories-ready.json"), "{damaged");
    assert.deepEqual(await ready.runs(), []);
    await assert.rejects(access(join(directory, "memories-ready.json.tmp")));
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("dismissing one card on Today drops only its runs, and the dock counts what is left", async () => {
  const { Ready } = require("../src/reading.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-ready-"));
  /** @type {number[]} */
  const badges = [];
  const ready = new Ready(join(directory, "memories-ready.json"), (count) => badges.push(count));
  /** @param {string} at @param {number} count @param {string} [agent] @returns {ReadyRun} */
  const run = (at, count, agent) => ({ title: "t", read: count, memories: Array.from({ length: count }, (_, id) => ({ id, title: "t", sell: false, work: false, why: "" })), at, seen: false, ...(agent ? { by: { kind: "agent", id: agent, label: agent, mark: "other" } } : {}) });
  try {
    await ready.add(run("2026-10-21T08:00:00.000Z", 2, "agent-grok"));
    await ready.add(run("2026-10-21T08:00:00.000Z", 3));
    await ready.add(run("2026-10-21T09:00:00.000Z", 4, "agent-grok"));
    await ready.dismiss([{ at: "2026-10-21T08:00:00.000Z", by: "agent-grok" }]);
    assert.deepEqual((await ready.runs()).map((kept) => kept.memories.length), [4, 3], "a run at the same moment from someone else stays");
    assert.equal(badges.at(-1), 7);
    await ready.dismiss([{ at: "2026-10-21T08:00:00.000Z", by: null }, { at: "2026-10-21T09:00:00.000Z", by: "agent-grok" }]);
    assert.deepEqual([await ready.runs(), badges.at(-1)], [[], 0]);
    for (const bad of [null, [], "x", [{ at: 1, by: null }], [{ at: "", by: 2 }], [{ at: "" }], Array.from({ length: 6 }, () => ({ at: "", by: null }))]) await assert.rejects(ready.dismiss(bad), /Invalid memories/);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("a deleted memory leaves every Today card, and a card it empties goes with it", async () => {
  const { Ready } = require("../src/reading.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-ready-"));
  /** @type {number[]} */
  const badges = [];
  const ready = new Ready(join(directory, "memories-ready.json"), (count) => badges.push(count));
  /** @param {string} at @param {number[]} ids @returns {ReadyRun} */
  const run = (at, ids) => ({ title: "t", read: ids.length, memories: ids.map((id) => ({ id, title: "t", sell: false, work: false, why: "" })), at, seen: false });
  try {
    await ready.add(run("2026-10-21T08:00:00.000Z", [7]));
    await ready.add(run("2026-10-21T09:00:00.000Z", [7, 8]));
    await ready.forget(7);
    assert.deepEqual((await ready.runs()).map((kept) => kept.memories.map((memory) => memory.id)), [[8]]);
    assert.equal(badges.at(-1), 1);
    const saves = badges.length;
    await ready.forget(99);
    assert.equal(badges.length, saves, "a memory on no card leaves the file alone");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("Lore runs what is due once, then looks again at the next hour it keeps, or within the hour", async (t) => {
  const { Schedule, LOOK_EVERY_MS } = require("../src/routines.cjs");
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const now = Date.parse("2026-10-14T12:00:00Z");
  /** @param {Partial<Routine>} fields @returns {Routine} */
  const routine = (fields) => ({ id: "synthesis", kind: "read", name: "Read connected apps", cadence: "daily", hour: 9, last_run: null, result: "", next_run: "2026-10-15T09:00:00Z", due: false, ...fields });
  let routines = [routine({ due: true }), routine({ id: "theirs", next_run: "2026-10-14T13:00:00Z" })];
  /** @type {string[]} */
  const ran = [];
  let looks = 0;
  const schedule = new Schedule(async () => { looks++; return routines; }, async (due) => {
    ran.push(due.id);
    routines = routines.map((each) => (each.id === due.id ? { ...each, due: false, next_run: "2026-10-14T12:30:00Z" } : each));
  }, () => now);
  // A launch and a wake at the same moment are one look, so a missed hour runs once.
  await Promise.all([schedule.check(), schedule.check()]);
  assert.deepEqual(ran, ["synthesis"], "only what is due, and only once");
  assert.equal(looks, 2, "once to run what was due, once more to see what is next");
  t.mock.timers.tick(30 * 60_000 - 1);
  assert.equal(looks, 2, "it waits for the soonest hour any routine names");
  // The timer's own look is under way, so this waits for it rather than starting another.
  t.mock.timers.tick(1);
  await schedule.check();
  assert.equal(looks, 3);
  routines = [];
  await schedule.check();
  t.mock.timers.tick(LOOK_EVERY_MS - 1);
  assert.equal(looks, 4, "with nothing to keep, Lore still looks within the hour");
  t.mock.timers.tick(1);
  await schedule.check();
  assert.equal(looks, 5);
  schedule.stop();
});

/** AUT-008: a check-in run end to end with a stand-in model, through the same rules the app posts by.
 * @param {CheckInVerdict} verdict @param {CheckInItem[]} items */
async function checkInWith(verdict, items) {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  const { CheckIns } = require("../src/checkin.cjs");
  /** @type {number[]} */
  const badges = [];
  /** @type {Array<CheckIn | null>} */
  const posted = [];
  /** @type {string[]} */
  const asked = [];
  const directory = await mkdtemp(join(tmpdir(), "lore-check-in-"));
  const checkIns = new CheckIns(join(directory, "check-in.json"), (count) => badges.push(count));
  const { agent, faux, events, loreHome } = await scriptedAgent({ checkedIn: async (job, said) => { posted.push(await checkIns.consider(said, job.items)); } });
  faux.setResponses([
    (context) => {
      const first = context.messages.find((message) => message.role === "user");
      asked.push(typeof first.content === "string" ? first.content : first.content.map((block) => (block.type === "text" ? block.text : "")).join(""));
      return fauxAssistantMessage(fauxToolCall("check_in", verdict), { stopReason: "toolUse" });
    },
    fauxAssistantMessage("Done.")
  ]);
  agent.checkIn({ items });
  await until(() => posted.length === 1);
  await rm(loreHome, { recursive: true, force: true });
  return { posted: posted[0], badges, asked: asked[0], events, checkIns, directory };
}

const TODAY = [{ id: 12, title: "Pricing call with Acme", source: "granola-1" }, { id: 13, title: "Weekly standup", source: "granola-1" }];

test("a check-in stays silent when nothing today is worth asking: no notification, no badge, no card", async () => {
  const { posted, badges, asked, events, checkIns, directory } = await checkInWith({ reach_out: false, why: "routine meetings, already covered", questions: [] }, TODAY);
  try {
    assert.equal(posted, null);
    assert.deepEqual(badges, [], "the dock is never touched");
    assert.equal(await checkIns.waiting(), null, "Today has no card to show");
    assert.match(asked, /lore-check-in/);
    assert.match(asked, /12: "Pricing call with Acme" from "granola-1"/);
    assert.ok(!events.some((event) => event.type === "working"), "it never locks the owner's composer");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("a check-in that finds something asks once, about real items only, and is replaced rather than stacked", async () => {
  const { announcement } = require("../src/checkin.cjs");
  const question = "You pushed back on the pricing call with Acme. What made you hold firm?";
  const { posted, badges, checkIns, directory } = await checkInWith({
    reach_out: true,
    why: "a decision with no reason given",
    questions: [{ question, memory: 12 }, { question: "What about the item Lore never brought in?", memory: 99 }, { question: "  ", memory: 13 }]
  }, TODAY);
  try {
    assert.deepEqual(posted?.questions, [{ question, memory: 12, title: "Pricing call with Acme" }], "only questions about today's items");
    assert.deepEqual(announcement(/** @type {CheckIn} */ (posted)), { title: "Five minutes on today?", body: question }, "one notification naming the thing");
    assert.deepEqual(badges, [1]);
    assert.equal((await checkIns.waiting())?.questions[0].question, question, "Today shows it");
    const again = await checkIns.consider({ reach_out: true, why: "", questions: [{ question: "Another?", memory: 13 }] }, TODAY);
    assert.equal(again, null, "at most one a day");
    assert.equal(await checkIns.expire(), true, "Not today retires it");
    assert.equal(await checkIns.waiting(), null);
    assert.equal(badges.at(-1), 0);
    await checkIns.answer();
    assert.equal((await checkIns.latest())?.state, "expired", "an expired check-in cannot be answered");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("a posted check-in opens its own thread with the questions as Lore's first words; the owner's answer clears it once it goes through", async () => {
  const { fauxAssistantMessage } = await import("@earendil-works/pi-ai");
  const { LoreAgent } = await import("../src/agent.mjs");
  const { CheckIns, opening } = require("../src/checkin.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-check-in-"));
  /** @type {number[]} */
  const badges = [];
  const checkIns = new CheckIns(join(directory, "check-in.json"), (count) => badges.push(count));
  const question = "You pushed back on the pricing call with Acme. What made you hold firm?";
  const { agent, faux, loreHome } = await scriptedAgent({ drafts: async () => 1 });
  /** @type {string[]} */
  const told = [];
  faux.setResponses([
    (context) => {
      told.push(context.messages.map((message) => (typeof message.content === "string" ? message.content : message.content.map((block) => (block.type === "text" ? block.text : "")).join(""))).join("\n---\n"));
      return fauxAssistantMessage("Thanks. Here is what I would keep.");
    }
  ]);
  try {
    // Yesterday's thread, still open on screen, is not where today's questions go.
    agent.ask("evening", "Yesterday's question?", "about yesterday");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const posted = /** @type {CheckIn} */ (await checkIns.consider({ reach_out: true, why: "a decision", questions: [{ question, memory: 12 }] }, TODAY));
    const { asked, note } = opening(posted);
    agent.ask("evening", asked, note);
    assert.deepEqual(LoreAgent.history(loreHome, "evening"), [{ text: question, owner: false }], "the thread opens with today's question, and only it");
    assert.deepEqual(agent.tasks().map((record) => [record.kind, record.state, record.phase]), [["evening", "stopped", "Five minutes on today"]]);
    await agent.prompt("They wanted a discount we never give first-year customers.", "evening");
    await checkIns.answer();
    assert.deepEqual(badges, [1, 0], "answering clears the dock");
    assert.equal(await checkIns.waiting(), null);
    assert.match(told[0], /lore-capture/, "the owner's first word still starts the capture skill");
    assert.ok(told[0].includes(question) && told[0].includes("(id 12)"), "the agent knows what was asked, about which item");
    assert.match(told[0], /ask two to four short follow-ups, one at a time/, "one sentence is not yet a memory");
    assert.match(told[0], /1 draft is still waiting/, "the check-in can draft, so it knows where drafts stand");
    assert.deepEqual(LoreAgent.history(loreHome, "evening").map((line) => [line.owner, line.text]), [
      [false, question],
      [true, "They wanted a discount we never give first-year customers."],
      [false, "Thanks. Here is what I would keep."]
    ]);
  } finally {
    await rm(loreHome, { recursive: true, force: true });
    await rm(directory, { recursive: true });
  }
});

test("the check-in thread interviews before it saves, and drafts for sale where it is, as a capture thread does", async () => {
  const renderer = await readFile(join(__dirname, "../src/renderer.js"), "utf8");
  const agent = await readFile(join(__dirname, "../src/agent.mjs"), "utf8");
  const drafting = (/** @type {string} */ source) => /const DRAFTING = new Set\((\[[^\]]*\])\);/.exec(source)?.[1];
  assert.deepEqual(JSON.parse(drafting(renderer) ?? "[]"), ["publish", "capture", "evening"], "its approval cards show in the thread");
  assert.equal(drafting(agent), drafting(renderer), "the threads that show drafts are the ones told where they stand");
  assert.doesNotMatch(agent, /tell them to choose Draft for sale/, "asked to sell, the agent drafts instead of pointing at a button");
  assert.match(agent, /follow lore-publish from those saved memories in this same thread/);
  const skill = (await readFile(join(__dirname, "../../../plugins/lore/skills/lore-capture/SKILL.md"), "utf8")).replace(/\s+/g, " ");
  for (const rule of ["When Lore's evening check-in asked", "one at a time", "Never ask more than four", "ordinary captures listen and propose as below", "follow `lore-publish` from those saved memories right here"]) assert.ok(skill.includes(rule), rule);
});

test("a check-in whose model fails says so, and one from an earlier day is retired while today's stays", async () => {
  const { fauxAssistantMessage } = await import("@earendil-works/pi-ai");
  const { CheckIns } = require("../src/checkin.cjs");
  /** @type {Array<CheckInVerdict | null>} */
  const verdicts = [];
  const { agent, faux, loreHome } = await scriptedAgent({ checkedIn: async (_job, verdict) => { verdicts.push(verdict); } });
  faux.setResponses([fauxAssistantMessage("", { stopReason: "error", errorMessage: "overloaded" })]);
  const directory = await mkdtemp(join(tmpdir(), "lore-check-in-"));
  const checkIns = new CheckIns(join(directory, "check-in.json"), () => {});
  try {
    agent.checkIn({ items: TODAY, mark: 13 });
    await until(() => verdicts.length === 1);
    assert.equal(verdicts[0], null, "no verdict, so the app records that it could not look");
    await checkIns.consider({ reach_out: true, why: "", questions: [{ question: "Why?", memory: 12 }] }, TODAY);
    assert.equal(await checkIns.retire(), false, "Run now later today keeps today's questions");
    assert.ok(await checkIns.waiting());
    const tomorrow = new Date(Date.now() + 24 * 60 * 60_000);
    assert.equal(await checkIns.retire(tomorrow), true, "the next day's run retires it");
    assert.equal(await checkIns.waiting(), null);
  } finally {
    await rm(loreHome, { recursive: true, force: true });
    await rm(directory, { recursive: true });
  }
});

test("the check-in waits for what is still being read, and gives way to the owner like a reading", async () => {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  /** @type {string[]} */
  const order = [];
  const { agent, faux, loreHome } = await scriptedAgent({
    memoriesReady: async () => { order.push("read"); },
    checkedIn: async (job) => { order.push(`checked ${job.items.length}`); }
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("memories_ready", { read: 2, memories: [] }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Done."),
    (_context, options) => new Promise((resolve) => {
      order.push("looking");
      options?.signal?.addEventListener("abort", () => resolve(fauxAssistantMessage("", { stopReason: "aborted" })), { once: true });
    }),
    fauxAssistantMessage("Kept that."),
    fauxAssistantMessage(fauxToolCall("check_in", { reach_out: false, why: "nothing new", questions: [] }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Done.")
  ]);
  try {
    agent.synthesize({ name: "granola-1", label: "Granola", item: "meeting", added: 2 });
    agent.checkIn({ items: TODAY });
    await until(() => order.includes("looking"));
    await agent.prompt("I learned to hire managers before scaling.", "capture");
    await until(() => order.length === 3);
    assert.deepEqual(order, ["read", "looking", "checked 2"]);
    assert.ok(!agent.tasks().some((record) => record.kind === "checkin"), "the check-in is no thread");
  } finally {
    await rm(loreHome, { recursive: true, force: true });
  }
});

test("a run the owner started is done only once its reading and check-in are", async () => {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  /** @type {string[]} */
  const order = [];
  const { agent, faux, loreHome } = await scriptedAgent({
    memoriesReady: async () => { order.push("read"); },
    checkedIn: async () => { order.push("checked"); }
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("memories_ready", { read: 2, memories: [] }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Done."),
    fauxAssistantMessage(fauxToolCall("check_in", { reach_out: false, why: "nothing new", questions: [] }), { stopReason: "toolUse" }),
    fauxAssistantMessage("Done.")
  ]);
  try {
    await agent.settled();
    assert.deepEqual(order, [], "with nothing in line it is done at once");
    agent.synthesize({ name: "granola-1", label: "Granola", item: "meeting", added: 2 });
    agent.checkIn({ items: TODAY });
    await agent.settled();
    assert.deepEqual(order, ["read", "checked"]);
  } finally {
    await rm(loreHome, { recursive: true, force: true });
  }
});

test("routines are added, paused, retimed and removed through the CLI, refused before it when malformed, and kept across a restart", async () => {
  const { listRoutines, changeRoutine, addRoutine } = require("../src/state.cjs");
  for (const [text, when] of [["", { cadence: "daily", hour: 9, day: 0 }], ["x".repeat(501), { cadence: "daily", hour: 9, day: 0 }], ["Fine", { cadence: "hourly", hour: 9, day: 0 }], ["Fine", { cadence: "daily", hour: 9.5, day: 0 }]]) {
    await assert.rejects(addRoutine("/nonexistent", text, when), /in a sentence|when it runs/);
  }
  await assert.rejects(changeRoutine("/nonexistent", "../x", "pause"), /Unknown routine/);
  await assert.rejects(changeRoutine("/nonexistent", "checkin", "delete"), /Unknown change/);
  const directory = await mkdtemp(join(tmpdir(), "lore-routines-"));
  try {
    const added = await addRoutine(directory, "-Every Sunday, remember what I read this week", { cadence: "weekly", hour: 18, day: 6 });
    assert.equal(added.name, "-Every Sunday, remember what I read this week", "a sentence that starts with a dash stays words");
    await changeRoutine(directory, "checkin", "pause");
    await changeRoutine(directory, added.id, "time", { cadence: "daily", hour: 7, day: 0 });
    const kept = await listRoutines(directory);
    assert.deepEqual(kept.map((routine) => [routine.id, routine.built_in, routine.paused, routine.cadence, routine.hour]), [["synthesis", true, false, "daily", 9], ["checkin", true, true, "weekdays", 18], ["collect", true, false, "weekly", 10], [added.id, false, false, "daily", 7]]);
    await assert.rejects(changeRoutine(directory, "checkin", "remove"), /paused, not removed/);
    await changeRoutine(directory, added.id, "remove");
    assert.deepEqual((await listRoutines(directory)).map((routine) => routine.id), ["synthesis", "checkin", "collect"]);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("an owner's routine runs their sentence as a quiet reading and is announced by it", async () => {
  const { readingPrompt } = await import("../src/agent.mjs");
  const { announcement, asking, landed } = require("../src/reading.cjs");
  const reading = asking({ id: "r-1", name: "Every Sunday, remember what I read" }, "Every Sunday, remember what I read");
  assert.deepEqual([reading.title, reading.phase], ["“Every Sunday, remember what I read”", "Working on “Every Sunday, remember what I read”"], "its sentence names it, with nothing tacked on");
  const prompt = readingPrompt(reading, "/Users/owner/.lore");
  assert.match(prompt, /asked Lore to do this on a schedule: "Every Sunday, remember what I read"/);
  assert.match(prompt, /owner's own routine, not a connected app/);
  const folder = "/Users/owner/.lore/memories";
  const run = landed(reading, { read: 0, memories: [{ file: "t.md", worth_selling: false, why: "" }] }, [{ id: 1, title: "t", content: "", project: "", source: "automation", source_path: `${folder}/t.md`, status: "private", updated_at: "" }], folder);
  assert.deepEqual(announcement(run), { title: "“Every Sunday, remember what I read”", body: "1 new memory. They stay private on this Mac." });
  assert.deepEqual(run.by, { kind: "routine", id: "r-1", label: "Every Sunday, remember what I read", mark: "clock" }, "what it wrote is on record as the routine's");
  const long = "Remember ".repeat(60);
  assert.equal(asking({ id: "r-2", name: long }, long).by.label, long.trim().slice(0, 200), "a routine named by a long prompt is cut to what the store keeps");
  const emoji = `${"a".repeat(199)}🧠 keep the lesson`;
  const cut = asking({ id: "r-3", name: emoji }, emoji).by.label;
  assert.equal(cut, `${"a".repeat(199)}🧠`, "a cut never splits an emoji");
});

test("Run now waits for a scheduled run under way, so the two never overlap", async () => {
  const { Schedule } = require("../src/routines.cjs");
  /** @type {string[]} */
  const order = [];
  /** @type {() => void} */
  let finish = () => {};
  const routine = /** @type {Routine} */ ({ id: "synthesis", kind: "read", name: "Read connected apps", cadence: "daily", hour: 9, last_run: null, result: "", next_run: "2026-10-15T09:00:00Z", due: true });
  const schedule = new Schedule(async () => [routine], async (due) => {
    order.push(`start ${due.id}`);
    if (due.id === "synthesis") await new Promise((done) => { finish = () => done(undefined); });
    order.push(`end ${due.id}`);
  });
  const checking = schedule.check();
  await until(() => order.length === 1);
  const pressed = schedule.runNow({ ...routine, id: "checkin", kind: "checkin" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(order, ["start synthesis"], "the owner's run waits");
  finish();
  await pressed;
  assert.deepEqual(order.slice(0, 4), ["start synthesis", "end synthesis", "start checkin", "end checkin"]);
  schedule.stop();
  await checking;
  schedule.stop();
});

test("what the owner's agents saved comes in once per check, and a check never overlaps another", async () => {
  const { Watch } = require("../src/agents.cjs");
  /** @param {string} name @param {number} added @returns {SourceRead} */
  const read = (name, added) => ({ name, label: "Grok", connector: "agent", added, updated: 0, unchanged: 0, errors: 0, state: "connected" });
  let ready = false;
  let asked = 0;
  /** @type {() => Promise<AgentsWaiting>} */
  let waiting = async () => ({ waiting: 2, sources: ["agent-a", "agent-b"] });
  /** @type {SourceRead[][]} */
  const landed = [];
  /** @type {SignInRequest[][]} */
  const signIns = [];
  const watch = new Watch({
    ready: () => ready,
    waiting: () => { asked++; return waiting(); },
    read: async (name) => [read(name, 1)],
    landed: (reads) => { landed.push(reads); },
    asked: (each) => { signIns.push(each); }
  });
  await watch.check();
  assert.equal(asked, 0, "with no store, the CLI is never asked");
  ready = true;
  await Promise.all([watch.check(), watch.check()]);
  assert.equal(asked, 2, "a check asked for during one under way waits for one more read, never an overlapping one");
  assert.deepEqual(landed, [[read("agent-a", 1), read("agent-b", 1)], [read("agent-a", 1), read("agent-b", 1)]], "both agents' saves, read through once per read");
  waiting = async () => { throw new Error("You are not authenticated"); };
  await watch.check();
  assert.equal(landed.length, 2, "signed out of Cloudflare: quiet, and nothing lands");
  waiting = async () => ({ waiting: 0, sources: [] });
  await watch.check();
  assert.equal(landed.length, 2, "nothing waiting is nothing to read");
  waiting = async () => ({ waiting: 1, sources: ["agent-a"] });
  await watch.check();
  assert.equal(asked, 5, "a failed check is retried at the next one");
  assert.equal(landed.length, 3);
  // XC-068: every answer says which apps ask to sign in, so a card for one that went away goes too.
  const asking = { id: "a".repeat(64), code: "4F7Q", client: "Claude", app: /** @type {AgentApp} */ ("claude"), name: "Claude", created_at: "", expires_at: "" };
  waiting = async () => ({ waiting: 0, sources: [], sign_ins: [asking] });
  await watch.check();
  assert.deepEqual(signIns.at(-1), [asking]);
  waiting = async () => ({ waiting: 0, sources: [], sign_ins: [] });
  await watch.check();
  assert.deepEqual(signIns.at(-1), []);
  assert.equal(signIns.length, 6, "heard on every answer, never on a failed check");
});

test("Lore asks its store again within seconds while an app waits to sign in, and often while it is on screen", async () => {
  const { Watch, PACE } = require("../src/agents.cjs");
  const asking = { id: "a".repeat(64), code: "4F7Q", client: "Claude", app: /** @type {AgentApp} */ ("claude"), name: "Claude", created_at: "", expires_at: "" };
  /** @type {() => Promise<AgentsWaiting>} */
  let waiting = async () => ({ waiting: 0, sources: [] });
  const watch = new Watch({ ready: () => true, waiting: () => waiting(), read: async () => [], landed: () => undefined, asked: () => undefined });
  await watch.check();
  assert.equal(watch.nextIn(true), PACE.onScreen, "on screen with nothing asking");
  assert.equal(watch.nextIn(false), PACE.away, "out of sight with nothing asking");
  waiting = async () => ({ waiting: 0, sources: [], sign_ins: [asking] });
  await watch.check();
  assert.equal(watch.nextIn(false), PACE.asking, "an app waiting on the owner is asked about quickly, in sight or not");
  waiting = async () => { throw new Error("offline"); };
  await watch.check();
  assert.equal(watch.nextIn(false), PACE.asking, "a failed check keeps the last answer's pace");
  waiting = async () => ({ waiting: 0, sources: [], sign_ins: [] });
  await watch.check();
  assert.equal(watch.nextIn(true), PACE.onScreen, "once allowed or gone, back to the usual pace");
  assert.ok(PACE.asking < PACE.onScreen && PACE.onScreen < PACE.away);
});

test("one agent whose read fails leaves the others' saves to land", async () => {
  const { Watch } = require("../src/agents.cjs");
  /** @type {SourceRead[][]} */
  const landed = [];
  const watch = new Watch({
    ready: () => true,
    waiting: async () => ({ waiting: 2, sources: ["agent-a", "agent-b"] }),
    read: async (name) => {
      if (name === "agent-a") throw new Error("collecting saves failed");
      return [{ name, label: "Muse", connector: "agent", added: 2, updated: 0, unchanged: 0, errors: 0, state: "connected" }];
    },
    landed: (reads) => { landed.push(reads); },
    asked: () => undefined
  });
  await watch.check();
  assert.deepEqual(landed.map((reads) => reads.map((each) => each.name)), [["agent-b"]]);
});

test("Lore finds the owner's agent apps by id, and opens only an installed one it knows", async () => {
  const { AgentApps } = require("../src/agents.cjs");
  const system = await mkdtemp(join(tmpdir(), "lore-apps-"));
  const own = await mkdtemp(join(tmpdir(), "lore-apps-"));
  try {
    /** @type {string[]} */
    const launched = [];
    const apps = new AgentApps([system, own], async (path) => (launched.push(path), ""));
    assert.deepEqual(await apps.installed(), [], "nothing installed is nothing found");
    await assert.rejects(apps.open("grok"), { message: /can't open that app/ }, "a known app not installed is not opened");
    await mkdir(join(own, "Grok Bot.app"));
    await mkdir(join(system, "Claude.app"));
    await mkdir(join(system, "Muse.app"));
    await mkdir(join(system, "Notes.app"));
    assert.deepEqual(await apps.installed(), ["grok", "claude"], "found in either place; Muse and other apps are never reported");
    await apps.open("grok");
    await apps.open("claude");
    assert.deepEqual(launched, [join(own, "Grok Bot.app"), join(system, "Claude.app")]);
    for (const id of ["muse", "other", "notes", "Notes.app", "../Notes.app", join(system, "Notes.app"), "__proto__", "toString", null, 7]) {
      await assert.rejects(apps.open(id), { message: /can't open that app/ }, String(id));
    }
    assert.equal(launched.length, 2, "an unknown id opens nothing");
    await assert.rejects(new AgentApps([own], async () => "No application knows how to open it").open("grok"), { message: /No application/ });
  } finally {
    await rm(system, { recursive: true });
    await rm(own, { recursive: true });
  }
});

test("an agent's saves are read through like any app's, named for the agent, and say where they came from", () => {
  const { worthReading, landed, announcement } = require("../src/reading.cjs");
  const apps = /** @type {SourceApp[]} */ ([{ id: "agent", name: "Personal agent", item: "save" }, { id: "granola", name: "Granola", item: "meeting" }]);
  const reading = worthReading({ name: "agent-1a2b3c4d5e6f7a8b", label: "Grok", connector: "agent", app: "grok", added: 3 }, apps);
  const by = { kind: "agent", id: "agent-1a2b3c4d5e6f7a8b", label: "Grok", mark: "grok" };
  assert.deepEqual(reading, { name: "agent-1a2b3c4d5e6f7a8b", label: "Grok", item: "save", added: 3, title: "Grok saved 3 things to Lore", phase: "Reading what Grok saved", from: "Grok", by });
  assert.equal(worthReading({ name: "agent-1", label: "Mine", connector: "agent", added: 1 }, apps)?.by.mark, "other", "an agent of no known app shows the plain agent mark");
  assert.equal(worthReading({ name: "agent-1a2b3c4d5e6f7a8b", label: "Grok", connector: "agent", added: 0 }, apps), null, "a re-save that only updated is not a new reading");
  assert.equal(worthReading({ name: "agent-1a2b3c4d5e6f7a8b", label: "", connector: "agent", added: 1 }, apps)?.title, "Personal agent saved 1 thing to Lore");
  const folder = "/Users/owner/.lore/memories";
  const run = landed(/** @type {Reading} */ (reading), { read: 3, memories: [{ file: "pricing.md", worth_selling: true, why: "a measured rule" }] }, [{ id: 7, title: "How I price sync", content: "", project: "", source: "automation", source_path: `${folder}/pricing.md`, status: "private", updated_at: "" }], folder);
  assert.equal(run.from, "Grok", "Today says which agent it came from");
  assert.deepEqual(run.by, by, "and who to put on record for what it wrote");
  assert.deepEqual(announcement(run), { title: "Grok saved 3 things to Lore", body: "1 new memory. 1 looks worth selling." });
  const granola = worthReading({ name: "granola-1", connector: "granola", added: 2 }, apps);
  assert.equal("from" in landed(/** @type {Reading} */ (granola), { read: 2, memories: [] }, [], folder), false, "an app's run names no agent");
});

test("an agent's saves are on Today as they come in, and what reading them writes joins that card", async () => {
  const { worthReading, saved, landed, announcement, Ready } = require("../src/reading.cjs");
  const apps = /** @type {SourceApp[]} */ ([{ id: "agent", name: "Personal agent", item: "save" }]);
  const grok = /** @type {Reading} */ (worthReading({ name: "agent-1", label: "Grok", connector: "agent", app: "grok", added: 2 }, apps));
  const claude = /** @type {Reading} */ (worthReading({ name: "agent-2", label: "Claude", connector: "agent", app: "claude", added: 1 }, apps));
  const card = saved(grok, [{ id: 4, title: "Window seats" }, { id: 5, title: "Pricing" }]);
  assert.deepEqual({ ...card, at: "" }, { title: "Grok saved 2 things to Lore", read: 2, memories: [{ id: 4, title: "Window seats", sell: false, work: false, why: "" }, { id: 5, title: "Pricing", sell: false, work: false, why: "" }], at: "", seen: false, by: grok.by, from: "Grok" });
  assert.deepEqual(announcement(card), { title: "Grok saved 2 things to Lore", body: "2 new memories. They stay private on this Mac." });
  const directory = await mkdtemp(join(tmpdir(), "lore-ready-"));
  /** @type {number[]} */
  const badges = [];
  const ready = new Ready(join(directory, "memories-ready.json"), (count) => badges.push(count));
  const folder = "/Users/owner/.lore/memories";
  const travel = { id: 9, title: "How I travel", content: "", project: "", source: "automation", source_path: `${folder}/travel.md`, status: "private", updated_at: "" };
  try {
    await ready.add(card);
    await ready.add(saved(claude, [{ id: 6, title: "Notes" }]));
    await ready.seen();
    await ready.extend(landed(grok, { read: 2, memories: [] }, [travel], folder, [`${folder}/travel.md`]));
    const [first, second] = await ready.runs();
    assert.deepEqual([first.title, first.seen, first.memories.map((memory) => memory.id)], ["Grok saved 2 things to Lore", false, [4, 5, 9]], "one card for Grok, back on top, with the new memory");
    assert.equal(second.title, "Claude saved 1 thing to Lore");
    assert.equal(badges.at(-1), 3);
    await ready.seen();
    await ready.extend(landed(grok, { read: 2, memories: [{ file: "travel.md", worth_selling: true, why: "a measured rule" }] }, [travel], folder));
    const [again] = await ready.runs();
    assert.deepEqual([again.seen, again.memories.map((memory) => [memory.id, memory.sell])], [true, [[4, false], [5, false], [9, true]]], "nothing new: still seen, and the later word on a memory wins");
    assert.equal((await ready.runs()).length, 2);
    await ready.clear();
    await ready.extend(landed(grok, { read: 2, memories: [] }, [travel], folder, [`${folder}/travel.md`]));
    assert.deepEqual((await ready.runs()).map((run) => run.memories.length), [1], "with no card left, it is a card of its own");
    await Promise.all([ready.extend(saved(grok, [{ id: 7, title: "Aisle" }])), ready.clear(), ready.add(saved(claude, [{ id: 8, title: "Later" }]))]);
    assert.deepEqual((await ready.runs()).map((run) => run.title), ["Claude saved 1 thing to Lore"], "changes made at once land in turn, so a clear is never undone by a card read before it");
  } finally {
    await rm(directory, { recursive: true });
  }
});
