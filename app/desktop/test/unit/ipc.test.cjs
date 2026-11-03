// APP-267: the main process's rules, driven through src/ipc.cjs with a recording ipcMain and fakes for everything
// Electron owns. The nine: store:online routing, the routines:run notify rule, AFTER_RUN.checkin and .read,
// proposeMemories, checkedIn, memoriesReady, the "still setting up" rejection before the agent exists, and watchSales'
// old-sale suppression and batching.
const assert = require("node:assert/strict");
const { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { after, test } = require("node:test");
const reading = require("../../src/reading.cjs");
const { Ipc, NOTHING_TO_ASK, COULD_NOT_LOOK } = require("../../src/ipc.cjs");

const root = mkdtempSync(join(tmpdir(), "ipc-unit-"));
after(() => rmSync(root, { recursive: true, force: true }));

const BY_AGENT = { kind: "agent", id: "claude", label: "Claude", mark: "claude" };
const NOT_READY = "Lore is still setting up on this Mac";

/** One Ipc over fakes, with everything it did kept for the test to read. @param {{agent?: any, window?: any, bridge?: Record<string, any>, ask?: (type: string, payload: any) => Promise<any>, loreHome?: string}} [options] */
function harness({ agent, window, bridge = {}, ask, loreHome = mkdtempSync(join(root, "home-")) } = {}) {
  const userData = mkdtempSync(join(root, "user-"));
  /** @type {Map<string, (...args: any[]) => any>} */
  const handlers = new Map();
  const seen = { emitted: /** @type {any[]} */ ([]), notes: /** @type {any[]} */ ([]), revealed: /** @type {any[]} */ ([]), lore: /** @type {string[][]} */ ([]), badge: /** @type {number[]} */ ([]), opened: /** @type {string[]} */ ([]) };
  const state = { agent, window, created: 0 };
  const schedule = { runNow: async (/** @type {any} */ _routine) => {}, check: async () => {} };
  const outgoing = { marked: /** @type {any[]} */ ([]), mark: (/** @type {any} */ ids) => void outgoing.marked.push(ids), push: async () => true };
  const main = {
    ipcMain: { handle: (/** @type {string} */ channel, /** @type {any} */ fn) => { assert.ok(!handlers.has(channel), `${channel} handled twice`); handlers.set(channel, fn); } },
    shell: { openExternal: async (/** @type {string} */ url) => void seen.opened.push(url), openPath: async () => "" },
    clipboard: { writeText() {} },
    dialog: {},
    systemPreferences: {},
    BrowserWindow: class {},
    paths: { userData, temp: userData, home: userData },
    notify: (/** @type {any} */ words, /** @type {() => void} */ onClick) => void seen.notes.push({ words, onClick }),
    emit: (/** @type {any} */ event) => void seen.emitted.push(event),
    reveal: (/** @type {any} */ event) => void seen.revealed.push(event),
    getWindow: () => state.window,
    createWindow: () => {
      state.created += 1;
      state.window = { shown: false, focused: false, show() { this.shown = true; }, focus() { this.focused = true; }, isFocused: () => false };
      return state.window;
    },
    getAgent: () => state.agent,
    requests: { ask: async (/** @type {string} */ type, /** @type {any} */ payload) => (ask ? ask(type, payload) : Promise.reject(new Error(`unexpected card ${type}`))) },
    badge: new reading.Badge((count) => void seen.badge.push(count)),
    bids: { matches: async () => [], dismiss: async () => {}, find: async () => null },
    updates: {},
    appearance: {},
    boot: async () => {},
    onFocus: () => {}
  };
  const calls = { booted: 0 };
  main.boot = async () => void (calls.booted += 1);
  const fake = {
    STORE: join(root, "no-store"),
    ATTENDED_KEYS: join(root, "keys", "attended"),
    lore: async (/** @type {string} */ _home, /** @type {string[]} */ args) => { seen.lore.push(args); return ""; },
    readState: async () => ({ node: { url: "https://store.example", agents: "https://inbox.example" } }),
    sourceCatalog: async () => [],
    ...bridge
  };
  const ipc = Ipc(/** @type {any} */ (main), /** @type {any} */ (fake));
  ipc.register(loreHome, /** @type {any} */ (schedule), /** @type {any} */ ({ check: async () => {} }), /** @type {any} */ (outgoing));
  const call = (/** @type {string} */ channel, /** @type {any[]} */ ...args) => /** @type {any} */ (handlers.get(channel))({}, ...args);
  return { ipc, call, handlers, seen, state, schedule, outgoing, calls, loreHome, userData };
}

const run = (/** @type {Partial<any>} */ extra = {}) => ({ title: "Notes read", read: 1, memories: [{ id: 1, title: "m", sell: false, work: false, why: "" }], at: new Date().toISOString(), seen: false, by: null, ...extra });

// 1. store:online routing

test("store:online forgets the inbox address and tells the window, whether the store went online or not", async () => {
  let reads = 0;
  let outcome = /** @type {Error | null} */ (null);
  const h = harness({ bridge: { readState: async () => ({ node: { url: "https://s", agents: `https://inbox/${++reads}` } }), storeOnline: async () => { if (outcome) throw outcome; } } });
  await h.call("snapshot:read");
  assert.equal(reads, 1);
  assert.equal(await h.ipc.hasInbox(h.loreHome), true);
  assert.equal(reads, 1, "the snapshot's address is trusted until the store changes");

  await h.call("store:online");
  assert.deepEqual(h.seen.emitted, [{ type: "changed" }]);
  assert.equal(await h.ipc.hasInbox(h.loreHome), true);
  assert.equal(reads, 2, "going online makes the next ask read the address again");

  outcome = new Error("Cloudflare said no");
  await assert.rejects(() => h.call("store:online"), { message: "Cloudflare said no" });
  assert.deepEqual(h.seen.emitted, [{ type: "changed" }, { type: "changed" }], "a failed attempt still refreshes the window");
});

// 2. routines:run notify rule

/** A routine whose run `ran` may change what Lore told the owner. */
function routineHarness(window, ran = async () => {}) {
  const routine = { id: "r1", name: "Morning", kind: "ask", result: "3 new" };
  const h = harness({ window, agent: { settled: async () => {} }, bridge: { listRoutines: async () => [routine] } });
  h.schedule.runNow = async () => void (await ran(h));
  return { h, routine };
}

test("routines:run notifies the owner when they are away and the run told them nothing", async () => {
  for (const window of [undefined, { isFocused: () => false }]) {
    const { h, routine } = routineHarness(window);
    assert.equal(await h.call("routines:run", "r1"), routine);
    assert.equal(h.seen.notes.length, 1);
    assert.deepEqual(h.seen.notes[0].words, { title: "“Morning” is done", body: "3 new" });
    h.seen.notes[0].onClick();
    assert.deepEqual(h.seen.revealed, [{ type: "show", view: "automations" }]);
  }
});

test("routines:run says 'Nothing new' for a run with no result", async () => {
  const { h, routine } = routineHarness(undefined);
  routine.result = "";
  await h.call("routines:run", "r1");
  assert.equal(h.seen.notes[0].words.body, "Nothing new");
});

test("routines:run stays quiet when the owner is looking, or the run already told them what it found", async () => {
  const focused = routineHarness({ isFocused: () => true });
  await focused.h.call("routines:run", "r1");
  assert.equal(focused.h.seen.notes.length, 0);

  const told = routineHarness({ isFocused: () => false }, (h) => h.ipc.newMemories.add(run()));
  await told.h.call("routines:run", "r1");
  assert.equal(told.h.seen.notes.length, 0);
});

test("routines:run refuses a routine Lore does not have, without running anything", async () => {
  const { h } = routineHarness(undefined);
  let ran = 0;
  h.schedule.runNow = async () => void (ran += 1);
  await assert.rejects(() => h.call("routines:run", "nope"), { message: "Lore does not run that one" });
  assert.equal(ran, 0);
});

// 3. AFTER_RUN.checkin

const ITEMS = [{ id: 1, title: "Pricing call" }];
const yesterday = () => new Date(Date.now() - 36 * 3_600_000).toISOString();

test("AFTER_RUN.checkin records a quiet day with the mark, and asks the model only when something came in", async () => {
  const asked = /** @type {any[]} */ ([]);
  const h = harness({ agent: { checkIn: (/** @type {any} */ job) => void asked.push(job), restart() {} } });
  await h.ipc.AFTER_RUN.checkin(h.loreHome, { items: [], mark: 9 });
  assert.deepEqual(h.seen.lore, [["automation", "result", "checkin", NOTHING_TO_ASK, "--mark", "9"]]);
  assert.deepEqual(asked, []);

  const busy = harness({ agent: { checkIn: (/** @type {any} */ job) => void asked.push(job), restart() {} } });
  await busy.ipc.AFTER_RUN.checkin(busy.loreHome, { items: ITEMS, mark: 4 });
  assert.deepEqual(asked, [{ items: ITEMS, mark: 4 }]);
  assert.deepEqual(busy.seen.lore, [], "the agent's verdict records the result later, through checkedIn");
});

test("AFTER_RUN.checkin says it could not look when items came in but the agent is not up", async () => {
  const h = harness();
  await h.ipc.AFTER_RUN.checkin(h.loreHome, { items: ITEMS });
  assert.deepEqual(h.seen.lore, [["automation", "result", "checkin", COULD_NOT_LOOK]]);
});

test("AFTER_RUN.checkin leaves a missed run, and a day already asked about, alone", async () => {
  const h = harness({ agent: { checkIn() { throw new Error("must not ask"); }, restart() {} } });
  await h.ipc.AFTER_RUN.checkin(h.loreHome, { items: ITEMS, missed: true });
  assert.deepEqual(h.seen.lore, []);

  await h.ipc.checkIns.consider({ reach_out: true, why: "w", questions: [{ memory: 1, question: "How did it go?" }] }, ITEMS);
  await h.ipc.AFTER_RUN.checkin(h.loreHome, { items: ITEMS });
  assert.deepEqual(h.seen.lore, [], "at most one a day");
});

test("AFTER_RUN.checkin retires yesterday's unanswered check-in and restarts the evening thread", async () => {
  const restarted = /** @type {string[]} */ ([]);
  const h = harness({ agent: { restart: (/** @type {string} */ task) => void restarted.push(task) } });
  writeFileSync(join(h.userData, "check-in.json"), JSON.stringify({ questions: [{ question: "q", memory: 1, title: "t" }], why: "", at: yesterday(), state: "waiting" }));
  await h.ipc.AFTER_RUN.checkin(h.loreHome, { items: [] });
  assert.deepEqual(restarted, ["evening"]);
  assert.equal((await h.ipc.checkIns.latest())?.state, "expired");
  assert.deepEqual(h.seen.badge, [0]);
});

// 3b. AFTER_RUN.read and queueReadings

const CATALOG = [{ id: "notes", name: "Notes", item: "note" }, { id: "agent", name: "Agent", item: "thing" }];

test("AFTER_RUN.read queues an app's new items for the agent to read, and shows nothing yet", async () => {
  const queued = /** @type {any[]} */ ([]);
  const h = harness({ agent: { synthesize: (/** @type {any} */ next) => void queued.push(next) }, bridge: { sourceCatalog: async () => CATALOG } });
  await h.ipc.AFTER_RUN.read(h.loreHome, { reads: [{ name: "n1", connector: "notes", added: 2 }, { name: "n2", connector: "notes", added: 0 }, { name: "x", connector: "unknown", added: 3 }] });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].name, "n1");
  assert.equal(queued[0].title, "Lore read your Notes notes");
  assert.deepEqual(await h.ipc.newMemories.runs(), []);
  assert.equal(h.seen.notes.length, 0);
});

test("AFTER_RUN.read does not even look at the apps when nothing was added", async () => {
  let looked = 0;
  const h = harness({ bridge: { sourceCatalog: async () => void (looked += 1) } });
  await h.ipc.AFTER_RUN.read(h.loreHome, { reads: [{ name: "n", connector: "notes", added: 0 }] });
  await h.ipc.AFTER_RUN.read(h.loreHome, {});
  assert.equal(looked, 0);
});

test("what an agent saved goes on Today at once: a card, the dock badge, a notification, and a judging read", async () => {
  const queued = /** @type {any[]} */ ([]);
  const h = harness({ agent: { synthesize: (/** @type {any} */ next) => void queued.push(next) }, bridge: { sourceCatalog: async () => CATALOG } });
  const saves = [{ id: 5, title: "a" }, { id: 6, title: "b" }];
  const shown = await h.ipc.queueReadings(h.loreHome, [{ name: "claude", connector: "agent", label: "Claude", added: 2, memories: saves }, { name: "empty", connector: "agent", label: "Quiet", added: 1, memories: [] }]);
  assert.equal(shown, true);

  const runs = await h.ipc.newMemories.runs();
  assert.equal(runs.length, 1, "an agent that saved nothing gets no card");
  assert.equal(runs[0].title, "Claude saved 2 things to Lore");
  assert.deepEqual(runs[0].memories.map((/** @type {any} */ memory) => memory.id), [5, 6]);
  assert.deepEqual(h.seen.badge, [2]);

  assert.deepEqual(h.seen.notes[0].words, { title: "Claude saved 2 things to Lore", body: "2 new memories. They stay private on this Mac." });
  h.seen.notes[0].onClick();
  assert.deepEqual(h.seen.revealed, [{ type: "show", view: "inventory", source: { id: "claude", label: "Claude" } }]);

  assert.equal(queued.length, 1);
  assert.deepEqual(queued[0].judge, saves);
});

test("queueReadings reports nothing shown for an app's items, and survives the catalog failing", async () => {
  const h = harness({ agent: { synthesize() {} }, bridge: { sourceCatalog: async () => CATALOG } });
  assert.equal(await h.ipc.queueReadings(h.loreHome, [{ name: "n", connector: "notes", added: 1 }]), false);
  const broken = harness({ bridge: { sourceCatalog: async () => { throw new Error("offline"); } } });
  assert.equal(await broken.ipc.queueReadings(broken.loreHome, [{ name: "n", connector: "notes", added: 1 }]), false);
});

test("runNow runs the routine through the CLI, does what its kind asks, then tells the window", async () => {
  const order = /** @type {string[]} */ ([]);
  const h = harness({ bridge: { runRoutine: async (/** @type {string} */ _home, /** @type {string} */ id) => { order.push(`run ${id}`); return { routine: { kind: "read" }, reads: [] }; } } });
  h.ipc.AFTER_RUN.read = async () => void order.push("after");
  await h.ipc.runNow(h.loreHome, /** @type {any} */ ({ id: "r9", kind: "read" }));
  assert.deepEqual(order, ["run r9", "after"]);
  assert.deepEqual(h.seen.emitted, [{ type: "changed" }]);
});

// 4. proposeMemories

const entry = (/** @type {string} */ title) => ({ title, content: `${title} body`, source_path: "pasted" });

/** The callbacks the agent gets, with the owner's answers to its cards scripted in order. */
function callbacks(/** @type {Array<(payload: any) => any>} */ answers, bridge = {}) {
  const payloads = /** @type {any[]} */ ([]);
  const h = harness({ agent: { activeTask: "capture", ask() {} }, ask: async (_type, payload) => { payloads.push(payload); return /** @type {any} */ (answers.shift())(payload); }, bridge });
  return { h, payloads, cb: h.ipc.agentCallbacks(h.loreHome, /** @type {any} */ (h.outgoing), /** @type {any} */ ((/** @type {unknown} */ value) => Array.isArray(value))) };
}

test("proposeMemories saves what the owner kept, and tells the window which task wrote them", async () => {
  const saved = [{ id: 1, title: "Kept" }];
  const captured = /** @type {any[]} */ ([]);
  const { h, cb } = callbacks([() => ({ entries: [entry("Kept")] })], { captureMemories: async (/** @type {string} */ _home, /** @type {any[]} */ entries) => { captured.push(entries); return saved; } });
  assert.deepEqual(await cb.proposeMemories([entry("Draft")]), { saved });
  assert.deepEqual(captured, [[entry("Kept")]]);
  assert.deepEqual(h.seen.emitted, [{ type: "saved", task: "capture", memories: saved }, { type: "changed" }]);
});

test("proposeMemories hands a note back to the agent instead of saving", async () => {
  const { h, cb } = callbacks([() => ({ entries: [entry("E")], note: "  shorter please  " })], { captureMemories: async () => { throw new Error("must not save"); } });
  assert.deepEqual(await cb.proposeMemories([entry("Draft")]), { entries: [entry("E")], note: "shorter please" });
  assert.deepEqual(h.seen.emitted, []);
});

test("proposeMemories refuses an answer that is not a list of memories", async () => {
  for (const bad of [null, { entries: "nope" }, {}]) {
    const { cb } = callbacks([() => bad]);
    await assert.rejects(() => cb.proposeMemories([entry("Draft")]), { message: "Invalid memory decision" });
  }
});

test("proposeMemories puts the card back, edits and all, when saving fails, then saves the retry", async () => {
  let attempts = 0;
  const edited = [entry("Edited")];
  const { h, payloads, cb } = callbacks([() => ({ entries: edited }), () => ({ entries: edited })], {
    captureMemories: async () => { if (++attempts === 1) throw new Error("disk full"); return [{ id: 2, title: "Edited" }]; }
  });
  assert.deepEqual(await cb.proposeMemories([entry("Draft")]), { saved: [{ id: 2, title: "Edited" }] });
  assert.equal(attempts, 2);
  assert.deepEqual(payloads[1].entries, edited, "the second card carries the owner's edits");
  assert.deepEqual(h.seen.emitted[0], { type: "message", task: "capture", text: "Lore could not save that: disk full. Your edits are still here." });
});

// 5. checkedIn

const JOB = { items: [{ id: 1, title: "Pricing call" }], mark: 7 };
const REACH = { reach_out: true, why: "w", questions: [{ memory: 1, question: "How did the pricing call go?" }] };

test("checkedIn records that the model could not look, and that it chose to stay quiet, without posting", async () => {
  const asked = /** @type {any[]} */ ([]);
  const h = harness({ agent: { ask: (/** @type {any[]} */ ...args) => void asked.push(args) } });
  const cb = h.ipc.agentCallbacks(h.loreHome, /** @type {any} */ (h.outgoing), /** @type {any} */ (() => true));
  await cb.checkedIn(/** @type {any} */ (JOB), null);
  await cb.checkedIn(/** @type {any} */ (JOB), /** @type {any} */ ({ reach_out: false, why: "", questions: [] }));
  assert.deepEqual(h.seen.lore, [
    ["automation", "result", "checkin", COULD_NOT_LOOK],
    ["automation", "result", "checkin", NOTHING_TO_ASK, "--mark", "7"]
  ]);
  assert.deepEqual(asked, []);
  assert.equal(h.seen.notes.length, 0);
});

test("checkedIn posts one worth-asking check-in a day: the thread, the dock badge, the notification", async () => {
  const asked = /** @type {any[][]} */ ([]);
  const h = harness({ agent: { ask: (/** @type {any[]} */ ...args) => void asked.push(args) } });
  const cb = h.ipc.agentCallbacks(h.loreHome, /** @type {any} */ (h.outgoing), /** @type {any} */ (() => true));
  await cb.checkedIn(/** @type {any} */ (JOB), /** @type {any} */ (REACH));
  assert.deepEqual(h.seen.lore, [["automation", "result", "checkin", "Asked about 1 thing", "--mark", "7"]]);
  assert.equal(asked.length, 1);
  assert.deepEqual(asked[0].slice(0, 2), ["evening", "How did the pricing call go?"]);
  assert.match(asked[0][2], /Pricing call/);
  assert.deepEqual(h.seen.badge, [1]);
  assert.deepEqual(h.seen.emitted, [{ type: "changed" }]);
  assert.deepEqual(h.seen.notes[0].words, { title: "Five minutes on today?", body: "How did the pricing call go?" });
  h.seen.notes[0].onClick();
  assert.deepEqual(h.seen.revealed, [{ type: "thread", task: "evening" }]);

  await cb.checkedIn(/** @type {any} */ (JOB), /** @type {any} */ (REACH));
  assert.equal(asked.length, 1, "a second verdict the same day posts nothing");
  assert.deepEqual(h.seen.lore[1], ["automation", "result", "checkin", NOTHING_TO_ASK, "--mark", "7"]);
});

test("checkedIn ignores questions about items that did not come in today", async () => {
  const h = harness({ agent: { ask() { throw new Error("must not ask"); } } });
  const cb = h.ipc.agentCallbacks(h.loreHome, /** @type {any} */ (h.outgoing), /** @type {any} */ (() => true));
  await cb.checkedIn(/** @type {any} */ (JOB), /** @type {any} */ ({ ...REACH, questions: [{ memory: 99, question: "About what?" }] }));
  assert.deepEqual(h.seen.lore, [["automation", "result", "checkin", NOTHING_TO_ASK, "--mark", "7"]]);
});

// 6. memoriesReady

const SAVES = [{ id: 1, title: "a" }, { id: 2, title: "b" }];

test("memoriesReady, for an agent's saves, keeps the judging of only the saves it was given", async () => {
  const judged = /** @type {any[]} */ ([]);
  const h = harness({ bridge: { judgeMemories: async (/** @type {string} */ _home, /** @type {any[]} */ memories) => void judged.push(memories) } });
  const cb = h.ipc.agentCallbacks(h.loreHome, /** @type {any} */ (h.outgoing), /** @type {any} */ (() => true));
  const read = { name: "claude", label: "Claude", title: "Claude saved 2 things to Lore", added: 2, judge: SAVES, by: BY_AGENT };
  await cb.memoriesReady(/** @type {any} */ (read), /** @type {any} */ ({ memories: [{ id: 1, worth_selling: true, why: "specific" }, { id: 99, worth_selling: true, why: "made up" }] }), []);
  assert.deepEqual(judged.map((memories) => memories.map((/** @type {any} */ memory) => memory.id)), [[1]]);
  assert.equal((await h.ipc.newMemories.runs()).length, 1);
  assert.deepEqual(h.seen.emitted, [{ type: "changed" }, { type: "ready" }]);
  assert.deepEqual(h.seen.lore, [], "no sync: the agent's saves are in the store already");
});

test("memoriesReady, when the judge named none of the saves, changes nothing", async () => {
  const h = harness({ bridge: { judgeMemories: async () => { throw new Error("must not judge"); } } });
  const cb = h.ipc.agentCallbacks(h.loreHome, /** @type {any} */ (h.outgoing), /** @type {any} */ (() => true));
  await cb.memoriesReady(/** @type {any} */ ({ name: "claude", title: "t", added: 2, judge: SAVES, by: BY_AGENT }), /** @type {any} */ ({ memories: [] }), []);
  assert.deepEqual(h.seen.emitted, []);
  assert.deepEqual(await h.ipc.newMemories.runs(), []);
});

test("memoriesReady, for an app, syncs, files the card, announces it and credits who wrote the memories", async (t) => {
  t.mock.method(console, "error", () => {});
  const judged = /** @type {any[]} */ ([]);
  const credited = /** @type {any[]} */ ([]);
  const loreHome = mkdtempSync(join(root, "home-"));
  const stored = [{ id: 3, title: "Pricing", status: "private", source_path: join(loreHome, "memories", "pricing.md") }];
  const by = { kind: "app", id: "notes", label: "Notes", mark: "notes" };
  /** @type {string[][]} */
  const told = [];
  const h = harness({
    loreHome,
    bridge: {
      lore: async (/** @type {string} */ _home, /** @type {string[]} */ args) => { told.push(args); return args[0] === "search" ? JSON.stringify(stored) : ""; },
      judgeMemories: async (/** @type {string} */ _home, /** @type {any[]} */ memories) => void judged.push(memories),
      creditMemories: async (/** @type {string} */ _home, /** @type {number[]} */ ids, /** @type {any} */ who) => void credited.push([ids, who])
    }
  });
  const cb = h.ipc.agentCallbacks(loreHome, /** @type {any} */ (h.outgoing), /** @type {any} */ (() => true));
  await cb.memoriesReady(/** @type {any} */ ({ name: "notes", label: "Notes", title: "Lore read your Notes notes", added: 1, by }), /** @type {any} */ ({ read: 1, memories: [{ file: "pricing.md", worth_selling: true, why: "w" }] }), []);

  assert.deepEqual(told, [["sync", "--source", "automation"], ["search", "--source", "automation", "--limit", "0", "--json"]]);
  assert.deepEqual(judged.map((memories) => memories.map((/** @type {any} */ memory) => memory.id)), [[3]]);
  assert.deepEqual(credited, [[[3], by]]);
  assert.equal((await h.ipc.newMemories.runs()).length, 1);
  assert.deepEqual(h.seen.emitted.map((event) => event.type), ["changed", "ready", "changed"]);
  assert.deepEqual(h.seen.notes[0].words, { title: "Lore read your Notes notes", body: "1 new memory. 1 looks worth selling." });
  h.seen.notes[0].onClick();
  assert.deepEqual(h.seen.revealed, [{ type: "show", view: "today" }]);
});

test("memoriesReady never loses the card or the banner to a judging or crediting failure", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const loreHome = mkdtempSync(join(root, "home-"));
  const stored = [{ id: 3, title: "Pricing", status: "private", source_path: join(loreHome, "memories", "pricing.md") }];
  const h = harness({
    loreHome,
    bridge: {
      lore: async (/** @type {string} */ _home, /** @type {string[]} */ args) => (args[0] === "search" ? JSON.stringify(stored) : ""),
      judgeMemories: async () => { throw new Error("judge down"); },
      creditMemories: async () => { throw new Error("credit down"); }
    }
  });
  const cb = h.ipc.agentCallbacks(loreHome, /** @type {any} */ (h.outgoing), /** @type {any} */ (() => true));
  await cb.memoriesReady(/** @type {any} */ ({ name: "notes", title: "t", added: 1, by: { kind: "app", id: "notes", label: "Notes", mark: "notes" } }), /** @type {any} */ ({ read: 1, memories: [{ file: "pricing.md", worth_selling: false, why: "" }] }), []);
  assert.equal(errors.mock.callCount(), 2);
  assert.equal((await h.ipc.newMemories.runs()).length, 1);
  assert.equal(h.seen.notes.length, 1);
});

test("memoriesReady records 'Nothing new' for a routine of the owner's own that wrote nothing, and announces nothing", async () => {
  const h = harness({ bridge: { lore: async (/** @type {string} */ _home, /** @type {string[]} */ args) => { told.push(args); return args[0] === "search" ? "[]" : ""; } } });
  /** @type {string[][]} */
  const told = [];
  const cb = h.ipc.agentCallbacks(h.loreHome, /** @type {any} */ (h.outgoing), /** @type {any} */ (() => true));
  await cb.memoriesReady(/** @type {any} */ ({ name: "r1", title: "t", added: 0, ask: "watch my inbox", by: { kind: "routine", id: "r1", label: "Mine", mark: "clock" } }), /** @type {any} */ ({ read: 0, memories: [] }), []);
  assert.deepEqual(told.at(-1), ["automation", "result", "r1", "Nothing new"]);
  assert.deepEqual(h.seen.emitted, [{ type: "changed" }]);
  assert.equal(h.seen.notes.length, 0);
});

// 7. "still setting up"

test("every call that needs the agent is refused with one plain sentence before it exists, and goes through once it does", async () => {
  const h = harness();
  for (const [channel, args] of /** @type {Array<[string, any[]]>} */ ([["agent:history", ["capture"]], ["agent:tasks", []], ["agent:restart", ["capture"]], ["auth:login", [{ providerId: "anthropic", type: "oauth" }]], ["auth:logout", ["anthropic"]]])) {
    assert.throws(() => h.call(channel, ...args), { message: NOT_READY }, channel);
  }
  await assert.rejects(() => h.call("agent:prompt", { text: "hi", task: "capture" }), { message: NOT_READY });
  assert.deepEqual(h.call("agent:status"), { credentials: [] });

  const history = /** @type {string[]} */ ([]);
  h.state.agent = { history: (/** @type {string} */ task) => (history.push(task), ["turn"]) };
  assert.deepEqual(h.call("agent:history", "capture"), ["turn"]);
  assert.deepEqual(history, ["capture"]);
});

test("a bad request is refused by name before the agent is even asked", async () => {
  const h = harness({ agent: { history() { throw new Error("must not reach the agent"); } } });
  assert.throws(() => h.call("agent:history", "not-a-task"), { message: "Invalid task" });
  await assert.rejects(() => h.call("agent:prompt", { text: "x".repeat(100_001), task: "capture" }), { message: "Invalid prompt" });
  await assert.rejects(() => h.call("agent:prompt", { text: "hi", task: "nope" }), { message: "Invalid prompt" });
  assert.throws(() => h.call("auth:login", { providerId: "evil", type: "oauth" }), { message: "Unsupported sign-in" });
});

test("setup:retry boots again only while there is still no agent", async () => {
  const h = harness();
  await h.call("setup:retry");
  assert.equal(h.calls.booted, 1);
  h.state.agent = {};
  assert.equal(await h.call("setup:retry"), undefined);
  assert.equal(h.calls.booted, 1);
});

// 8. watchSales

let tx = 0;
const sale = (/** @type {string} */ at, /** @type {Record<string, any>} */ extra = {}) => ({ network: "base", tx: `0x${++tx}`, sold_at: at, price_usd: 1, title: "Pricing", kind: "piece", ...extra });
const at = (/** @type {number} */ minute) => `2026-11-01T10:${String(minute).padStart(2, "0")}:00Z`;

/** A store that has gone online, whose ledger reads `rows` (newest first) every time, with the sales marker `marker` on disk. */
function salesHarness(/** @type {any[] | Error} */ rows, /** @type {unknown} */ marker, window = { isFocused: () => true }) {
  const reads = /** @type {number[]} */ ([]);
  const h = harness({ window, bridge: { readSales: async () => { reads.push(reads.length); if (rows instanceof Error) throw rows; return rows; } } });
  mkdirSync(join(h.loreHome, "node"));
  writeFileSync(join(h.loreHome, "node", "wrangler.jsonc"), "{}");
  const file = join(h.userData, "sales-seen.json");
  if (marker !== undefined) writeFileSync(file, JSON.stringify(marker));
  return { h, reads, file };
}

/** Let the check watchSales starts on its own finish, then a second full one: a check that overlaps one under way is skipped. */
async function twoChecks(/** @type {{check: () => Promise<void>}} */ watch, /** @type {number[]} */ reads) {
  while (reads.length < 2) {
    await watch.check();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

test("watchSales stays quiet on a first look at an old store, and remembers where it stopped", async () => {
  const rows = [sale(at(5)), sale(at(1))];
  const { h, reads, file } = salesHarness(rows, undefined);
  const watch = h.ipc.watchSales(h.loreHome);
  try {
    await twoChecks(watch, reads);
  } finally {
    watch.stop();
  }
  assert.equal(h.seen.notes.length, 0);
  assert.deepEqual(h.seen.emitted, []);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { sold_at: rows[0].sold_at, key: `base:${rows[0].tx}` });
});

test("watchSales announces only what is newer than the last sale announced, and opens the store from the banner", async () => {
  const old = sale(at(1));
  const fresh = sale(at(9), { title: "Launch playbook", price_usd: 2.5 });
  const { h, reads } = salesHarness([fresh, old], { sold_at: old.sold_at, key: `base:${old.tx}` }, null);
  const watch = h.ipc.watchSales(h.loreHome);
  try {
    await twoChecks(watch, reads);
  } finally {
    watch.stop();
  }
  assert.deepEqual(h.seen.notes.map((note) => note.words), [{ title: "You sold a piece", body: "Launch playbook · $2.50 by an agent" }]);
  assert.deepEqual(h.seen.emitted, [{ type: "sold" }]);

  h.seen.notes[0].onClick();
  assert.equal(h.state.created, 1, "a banner clicked with no window open makes one");
  assert.equal(h.state.window.shown && h.state.window.focused, true);
  assert.deepEqual(h.seen.emitted.at(-1), { type: "show", view: "store" });
});

test("watchSales announces nothing for a ledger with no sale newer than the marker", async () => {
  const old = sale(at(1));
  const { h, reads } = salesHarness([old], { sold_at: old.sold_at, key: `base:${old.tx}` });
  const watch = h.ipc.watchSales(h.loreHome);
  try {
    await twoChecks(watch, reads);
  } finally {
    watch.stop();
  }
  assert.equal(h.seen.notes.length, 0);
  assert.deepEqual(h.seen.emitted, []);
});

test("watchSales folds a burst of sales into one banner", async () => {
  const old = sale(at(1));
  const burst = [at(6), at(5), at(4), at(3)].map((when) => sale(when, { price_usd: 1 }));
  const { h, reads } = salesHarness([...burst, old], { sold_at: old.sold_at, key: `base:${old.tx}` });
  const watch = h.ipc.watchSales(h.loreHome);
  try {
    await twoChecks(watch, reads);
  } finally {
    watch.stop();
  }
  assert.deepEqual(h.seen.notes.map((note) => note.words), [{ title: "You sold 4 pieces", body: "$4.00" }]);
  assert.deepEqual(h.seen.emitted, [{ type: "sold" }]);
});

test("watchSales treats a ledger table that does not exist yet as empty, so the very first sale is announced", async () => {
  const { h, reads, file } = salesHarness(new Error("D1_ERROR: no such table: sales"), undefined);
  const watch = h.ipc.watchSales(h.loreHome);
  try {
    await twoChecks(watch, reads);
  } finally {
    watch.stop();
  }
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { sold_at: "", key: "" });
  assert.equal(h.seen.notes.length, 0);
});

test("watchSales keeps its marker and says nothing when the ledger cannot be read", async () => {
  const { h, reads, file } = salesHarness(new Error("offline"), undefined);
  const watch = h.ipc.watchSales(h.loreHome);
  try {
    await twoChecks(watch, reads);
  } finally {
    watch.stop();
  }
  assert.equal(h.seen.notes.length, 0);
  assert.throws(() => readFileSync(file), { code: "ENOENT" });
});

test("watchSales never asks the CLI until a store has gone online", async () => {
  const reads = /** @type {number[]} */ ([]);
  const h = harness({ bridge: { readSales: async () => void reads.push(1) } });
  const watch = h.ipc.watchSales(h.loreHome);
  try {
    await watch.check();
  } finally {
    watch.stop();
  }
  assert.deepEqual(reads, []);
});
