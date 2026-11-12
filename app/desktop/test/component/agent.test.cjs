// Whole turns of the scripted agent (pi's stand-in model over the real sandbox): cards, readings, check-ins, and the
// decisions only Electron main may pipe, through the real CLI. XC-097: split from test/unit/agent.test.cjs; a turn runs
// LoreAgent.prompt, which spawns through the sandbox, so these are component tests. APP-272: the memory card and the
// routines, which check only what the app sends `lore`, run against a stand-in in test/unit/agent.test.cjs.
const assert = require("node:assert/strict");
const { mkdir, mkdtemp, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { test } = require("node:test");
// Each test process gets its own scratch store, keys and CLI runtime; required before anything loads ../../src/state.cjs.
const { readState } = require("../../support/scratch.cjs");
const { scriptedAgent, until } = require("../../support/scripted.cjs");

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
    const { asked } = await import("../../src/agent.mjs");
    assert.deepEqual(asked([/** @type {OwnerQuestion} */ (question)]), [{ question: "Pick one", header: "Pick", options: [{ label: "A", description: "a" }], multiSelect: false }]);
    assert.ok(!JSON.stringify(shown).includes("planted text"));
  } finally {
    agent.dispose();
    await rm(loreHome, { recursive: true, force: true });
  }
});

test("a refused sign-in refresh asks the owner to sign in again; no model error ever reaches the thread", async (t) => {
  const { LoreAgent, latestTaskRecord } = await import("../../src/agent.mjs");
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

// APP-272: the real round trip for `lore publication decide`: the attended gate refuses a piped or forged decision,
// and admits this launch's key through support/scratch.cjs's attended_cli.py.
test("only Electron main can pipe a decision, and only for a card that is drafted", async () => {
  const { decide } = require("../../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const card = { title: "x", teaser: "y", content: "z", kind: "claim", topic: "t", provenance: [1] };
  try {
    const piped = spawnSync("uv", ["run", "lore", "publication", "decide"], {
      cwd: join(__dirname, "../../../.."),
      env: { ...process.env, LORE_HOME: directory, NO_COLOR: "1" },
      input: JSON.stringify({ candidate: card, approve: true }),
      encoding: "utf8"
    });
    assert.equal(piped.status, 1);
    assert.match(piped.stderr, /only from the Lore desktop app/);
    // The old marker, which the agent's shell could set itself, no longer opens the gate.
    const forged = spawnSync("uv", ["run", "lore", "publication", "decide"], {
      cwd: join(__dirname, "../../../.."),
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

// APP-272: the real round trip for `lore publication extras`: drafted by the agent, decided only on the launch key.
test("new free parts for a live piece are staged by the agent and decided only by Electron main", async () => {
  const { lore, decide, extrasCandidates, decideExtras } = require("../../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  /** @param {string[]} args @param {string} input */
  const piped = (args, input) => spawnSync("uv", ["run", "lore", ...args], {
    cwd: join(__dirname, "../../../.."),
    env: { ...process.env, LORE_HOME: directory, NO_COLOR: "1" },
    input,
    encoding: "utf8"
  });
  const card = { title: "Price low", teaser: "How to set a first price.", content: "Price low first.", kind: /** @type {const} */ ("claim"), topic: "First prices", sample: "We guessed at first. Then we tested.", provenance: [1] };
  const extras = { publication_id: 1, sample: "We started at a dollar. Few paid.", useful_if: "you price an API", not_useful_if: "" };
  try {
    await lore(directory, ["capture", "apply", "-"], JSON.stringify([{ title: "Pricing", content: "Price low first.", project: "pricing" }]));
    assert.equal(piped(["publication", "extras", "draft", "-"], JSON.stringify([extras])).status, 1, "nothing is on sale yet");
    await lore(directory, ["publication", "draft", "-"], JSON.stringify([card]));
    await decide(directory, card, card, true);
    await lore(directory, ["publication", "extras", "draft", "-"], JSON.stringify([extras]));
    const [staged] = await extrasCandidates(directory);
    assert.deepEqual(staged.extras, extras);
    assert.equal(staged.piece.title, "Price low");
    assert.equal(staged.piece.sample, card.sample);
    const refused = piped(["publication", "extras", "decide"], JSON.stringify({ extras, approve: true }));
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /only from the Lore desktop app/);
    await decideExtras(directory, extras, { ...extras, sample: "The owner's excerpt. In their words." }, true);
    assert.deepEqual(await extrasCandidates(directory), []);
    const listed = await lore(directory, ["publication", "list"]);
    assert.match(listed, /free sample: The owner's excerpt\. In their words\./);
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

/** AUT-008: a check-in run end to end with a stand-in model, through the same rules the app posts by.
 * @param {CheckInVerdict} verdict @param {CheckInItem[]} items */
async function checkInWith(verdict, items) {
  const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
  const { CheckIns } = require("../../src/checkin.cjs");
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
  const { announcement } = require("../../src/checkin.cjs");
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
  const { LoreAgent } = await import("../../src/agent.mjs");
  const { CheckIns, opening } = require("../../src/checkin.cjs");
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

test("a check-in whose model fails says so, and one from an earlier day is retired while today's stays", async () => {
  const { fauxAssistantMessage } = await import("@earendil-works/pi-ai");
  const { CheckIns } = require("../../src/checkin.cjs");
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
