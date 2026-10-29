// APP-062: the owner-gate callbacks main.cjs hands the agent — the cards it waits on, what each answer tells the agent,
// the Cloudflare sign-in's wording, and that a task never stays at needs_you once the owner's step is over.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { rm } = require("node:fs/promises");
const { join } = require("node:path");
const { test } = require("node:test");
// Each test process gets its own scratch store, keys and CLI runtime; required before anything loads ../src/state.cjs.
require("../support/scratch.cjs");
const { scriptedAgent } = require("../support/scripted.cjs");
const { OwnerRequests, ownerGates } = require("../src/owner.cjs");
const { cloudflareSignIn, openable } = require("../src/state.cjs");

/** Requests over a window that is open unless told otherwise, with every event it sent. */
function requests(open = () => true) {
  /** @type {AgentEvent[]} */
  const sent = [];
  return { owner: new OwnerRequests({ open, emit: (event) => void sent.push(event) }), sent };
}

test("a card resolves with the owner's answer, once, and an answer Lore did not ask for is refused", async () => {
  const { owner, sent } = requests();
  const asked = owner.ask("open", { url: "https://basescan.org/", title: "Check" }, "deploy");
  assert.equal(sent.length, 1);
  const card = /** @type {AgentRequest & {url: string}} */ (sent[0]);
  assert.equal(card.type, "open");
  assert.equal(card.task, "deploy");
  assert.equal(card.url, "https://basescan.org/");
  assert.equal(typeof card.id, "string");
  owner.answer({ id: card.id, value: "done" });
  assert.equal(await asked, "done");
  for (const bad of [{ id: card.id, value: "again" }, { id: "nope" }, { id: 1 }, null, undefined]) {
    assert.throws(() => owner.answer(bad), { message: "Unknown agent request" });
  }
});

test("a card taken back is dismissed on screen and can no longer be answered", async () => {
  const { owner, sent } = requests();
  const stop = new AbortController();
  const asked = owner.ask("question", { questions: [] }, undefined, stop.signal);
  const { id } = /** @type {AgentRequest} */ (sent[0]);
  stop.abort();
  await assert.rejects(asked, { message: "Cancelled" });
  assert.deepEqual(sent[1], { type: "dismiss", id });
  assert.throws(() => owner.answer({ id, value: {} }), { message: "Unknown agent request" });
});

test("with no window open, nothing is shown and the card fails at once", async () => {
  const { owner, sent } = requests(() => false);
  await assert.rejects(owner.ask("cloudflare", {}, "deploy"), { message: "Lore window is closed" });
  assert.deepEqual(sent, []);
});

test("every card still waiting fails when Lore closes, and an abort afterwards says nothing more", async () => {
  const { owner, sent } = requests();
  const stop = new AbortController();
  const first = owner.ask("open", {}, "deploy", stop.signal);
  const second = owner.ask("cloudflare", {}, "deploy");
  owner.rejectAll("Lore closed");
  await assert.rejects(first, { message: "Lore closed" });
  await assert.rejects(second, { message: "Lore closed" });
  stop.abort();
  assert.equal(sent.filter((event) => event.type === "dismiss").length, 0);
  for (const event of sent) assert.throws(() => owner.answer({ id: /** @type {AgentRequest} */ (event).id, value: "done" }), { message: "Unknown agent request" });
});

test("main.cjs fails waiting cards on quit and on window close, and answers and gates go through owner.cjs", () => {
  // main.cjs cannot be required outside Electron, so its wiring is read as text (as ipc-contract.test.cjs does).
  const main = readFileSync(join(__dirname, "..", "src", "main.cjs"), "utf8");
  assert.match(main, /app\.on\("before-quit", \(\) => \{[^}]*requests\.rejectAll\("Lore closed"\);/);
  assert.match(main, /window\.on\("closed", \(\) => \{[^}]*requests\.rejectAll\("Lore window closed"\);/);
  assert.match(main, /ipcMain\.handle\("agent:respond", \(_event, response\) => requests\.answer\(response\)\);/);
  assert.match(main, /\.\.\.ownerGates\(\{/);
  assert.doesNotMatch(main, /\bpending\.(set|get|delete|clear|values)\(/, "no second list of waiting cards");
});

/** Gates over a scripted owner: `answer` is what the card returns. @param {unknown} answer */
function gates(answer) {
  /** @type {Array<[string, Record<string, unknown>]>} */
  const asked = [];
  const calls = { signIn: 0, notice: 0 };
  const built = ownerGates({
    ask: async (type, payload) => (asked.push([type, payload]), answer),
    signIn: async (opened) => (calls.signIn++, opened(), "Signed in as owner@example.com"),
    notice: () => void calls.notice++,
    openable
  });
  return { ...built, asked, calls };
}

const PAGE = { title: "Fund your wallet", url: "https://www.coinbase.com/buy", note: "Buy a little USDC." };

test("open_url refuses an address off the allowlist without asking the owner", async () => {
  const { openUrl, asked } = gates("done");
  assert.equal(await openUrl({ ...PAGE, url: "https://evil.example/" }), "Lore does not open that address; only Coinbase, Cloudflare and Basescan pages.");
  assert.equal(await openUrl({ ...PAGE, url: "http://www.coinbase.com/buy" }), "Lore does not open that address; only Coinbase, Cloudflare and Basescan pages.");
  assert.deepEqual(asked, []);
});

test("open_url tells the agent to verify on done, to ask on stuck, and that the owner declined otherwise", async () => {
  const done = gates("done");
  assert.equal(await done.openUrl(PAGE), "The owner says they finished there; verify from state before going on.");
  assert.deepEqual(done.asked, [["open", PAGE]]);
  assert.equal(await gates("stuck").openUrl(PAGE), "The owner got stuck on that page; ask what happened.");
  for (const other of [false, undefined, null, "later", "DONE"]) {
    assert.equal(await gates(other).openUrl(PAGE), "The owner chose not to open it right now.");
  }
});

test("cloudflare_login declined starts no sign-in, and accepted signs in and tells the owner where to finish", async () => {
  for (const no of [false, undefined, null]) {
    const declined = gates(no);
    assert.equal(await declined.cloudflareLogin(), "The owner chose not to sign in to Cloudflare right now.");
    assert.deepEqual(declined.calls, { signIn: 0, notice: 0 });
    assert.deepEqual(declined.asked, [["cloudflare", {}]]);
  }
  const accepted = gates(true);
  assert.equal(await accepted.cloudflareLogin(), "Signed in as owner@example.com");
  assert.deepEqual(accepted.calls, { signIn: 1, notice: 1 }, "the notice goes out when the sign-in opens its page");
  // A sign-in that fails before any page opens tells the owner nothing about a browser.
  let notices = 0;
  const unopened = ownerGates({ ask: async () => true, signIn: async () => { throw new Error("not logged in"); }, notice: () => void notices++, openable });
  await assert.rejects(unopened.cloudflareLogin(), { message: "not logged in" });
  assert.equal(notices, 0);
});

/** A stand-in `lore node login`: says `lines`, then ends as `end` says, or waits until stopped. @param {string[]} lines @param {"ok" | Error | "hang"} end */
function login(lines, end) {
  return async (/** @type {(line: string) => void} */ onLine, /** @type {AbortSignal} */ signal) => {
    for (const line of lines) onLine(line);
    if (end === "ok") return;
    if (end instanceof Error) throw end;
    await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true }));
  };
}

test("the Cloudflare sign-in opens only the dash.cloudflare.com page it streams and ends with the CLI's last line", async () => {
  /** @type {string[]} */
  const opened = [];
  const said = await cloudflareSignIn("/nonexistent", (url) => opened.push(url), {
    login: login(["Opening https://example.com/not-this", "Visit this link to authenticate: https://dash.cloudflare.com/oauth2/auth?x=1 now", "Successfully logged in."], "ok")
  });
  assert.deepEqual(opened, ["https://dash.cloudflare.com/oauth2/auth?x=1"]);
  assert.equal(said, "Successfully logged in.");
});

test("a failed Cloudflare sign-in says the CLI's last line without its lore: prefix, or the error when it said nothing", async () => {
  await assert.rejects(cloudflareSignIn("/nonexistent", () => {}, { login: login(["working", "lore: Cloudflare sign-in did not complete"], new Error("exited with 1")) }), { message: "Cloudflare sign-in did not complete" });
  await assert.rejects(cloudflareSignIn("/nonexistent", () => {}, { login: login(["Wrangler crashed"], new Error("exited with 1")) }), { message: "Wrangler crashed" });
  await assert.rejects(cloudflareSignIn("/nonexistent", () => {}, { login: login([], new Error("spawn lore ENOENT")) }), { message: "spawn lore ENOENT" });
});

test("a Cloudflare sign-in the owner cancels, or one left waiting too long, stops and says so", async () => {
  const stop = new AbortController();
  const cancelled = cloudflareSignIn("/nonexistent", () => {}, { signal: stop.signal, login: login(["lore: waiting"], "hang") });
  stop.abort();
  await assert.rejects(cancelled, { message: "Cancelled" });
  // AbortSignal.timeout does not hold the process open; in the app the window does, here this timer does.
  const alive = setTimeout(() => {}, 5000);
  try {
    await assert.rejects(cloudflareSignIn("/nonexistent", () => {}, { wait: 20, login: login(["lore: waiting"], "hang") }), { message: "Cloudflare sign-in didn't finish. Try again." });
  } finally {
    clearTimeout(alive);
  }
});

/** The states a turn's task went through, from the records the agent emitted. @param {AgentEvent[]} events */
const states = (events) => events.flatMap((event) => (event.type === "task" ? [[event.task.state, event.task.phase ?? null]] : []));

for (const [name, openUrl] of /** @type {Array<[string, LoreAgentOptions["openUrl"]]>} */ ([
  ["throws", async () => { throw new Error("the window went away"); }],
  ["is declined", async () => "The owner chose not to open it right now."]
])) {
  test(`a task waiting on the owner goes back to working when the step ${name}`, async () => {
    const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
    const { agent, faux, events, loreHome } = await scriptedAgent({ openUrl });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("open_url", PAGE), { stopReason: "toolUse" }),
      fauxAssistantMessage("Done.")
    ]);
    try {
      await agent.prompt("Help me fund my wallet", "publish");
      const seen = states(events);
      const waiting = seen.findIndex(([state, phase]) => state === "needs_you" && phase === PAGE.title);
      assert.ok(waiting > 0, `needs_you while the owner acts: ${JSON.stringify(seen)}`);
      assert.equal(seen[waiting + 1]?.[0], "working", `working again once the step is over: ${JSON.stringify(seen)}`);
      assert.notEqual(seen.at(-1)?.[0], "needs_you");
    } finally {
      agent.dispose();
      await rm(loreHome, { recursive: true, force: true });
    }
  });
}
