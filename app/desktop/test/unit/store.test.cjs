// The store and the memory, feedback and price actions, in process: what the app sends `lore` and what it makes of
// the answer. APP-272: a stand-in CLI in this process (support/fake-cli.cjs) answers, so nothing here starts a process;
// the real round trip through the CLI's own parser is test/component/store.test.cjs.
const assert = require("node:assert/strict");
const { rm, writeFile } = require("node:fs/promises");
const { join } = require("node:path");
const { test } = require("node:test");
// Required before anything loads ../../src/state.cjs: scratch store and launch keys, and a CLI that is a function.
const { fakeCli, json, refused } = require("../../support/fake-cli.cjs");

const HOME = "/lore-home";

/** The calls a stand-in took, one line each as the old shell stand-ins logged them: argv, LORE_UNATTENDED, and stdin
 * for `profile`. @param {import("../../support/fake-cli.cjs").Call[]} calls @param {string[]} [skip] */
const logged = (calls, skip = ["desktop-state", "cards"]) => calls
  .filter((call) => !skip.includes(call.args[0]) && call.args.join(" ") !== "node accounts --json")
  .map((call) => `${call.args.join(" ")} unattended=${call.env.LORE_UNATTENDED ?? ""} stdin=${call.args[0] === "profile" ? call.input : ""}\n`)
  .join("");

test("crediting a big reading goes to the CLI in batches it takes", async () => {
  const { creditMemories } = require("../../src/state.cjs");
  const calls = fakeCli();
  const by = { kind: "routine", id: "r1", label: "Sunday", mark: "clock" };
  const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
  await creditMemories(HOME, ids, by);
  await creditMemories(HOME, [], by);
  assert.deepEqual(calls.map((call) => call.args), [["memory", "credit", "-"], ["memory", "credit", "-"], ["memory", "credit", "-"]], "nothing credited, nothing asked");
  assert.deepEqual(calls.map((call) => JSON.parse(/** @type {string} */ (call.input))), [{ ids: ids.slice(0, 500), by }, { ids: ids.slice(500, 1000), by }, { ids: [1001], by }]);
});

test("what a reading judged of a memory goes to the CLI in batches it takes, and reads back on its sheet", async () => {
  const { judgeMemories, readMemory } = require("../../src/state.cjs");
  const verdict = { sell: false, work: false, why: "a personal preference" };
  const calls = fakeCli((args) => (args[1] === "show" ? json({ id: 1, title: "Travel preferences", content: "Window seat.", verdict: args[2] === "1" ? verdict : null }) : json({ judged: 1 })));
  assert.equal((await readMemory(HOME, 2)).verdict, null, "a memory no reading judged offers Draft for sale as before");
  await judgeMemories(HOME, []);
  assert.equal(calls.length, 1, "nothing judged, nothing asked");
  await judgeMemories(HOME, [{ id: 1, title: "Travel preferences", sell: false, work: false, why: "a personal preference" }, ...Array.from({ length: 1000 }, (_, i) => ({ id: i + 2, title: "", sell: true, work: false, why: "" }))]);
  const judged = calls.slice(1).map((call) => [call.args, JSON.parse(/** @type {string} */ (call.input)).memories]);
  assert.deepEqual(judged.map(([args]) => args), [["memory", "judge", "-"], ["memory", "judge", "-"], ["memory", "judge", "-"]]);
  assert.deepEqual(judged.map(([, memories]) => memories.length), [500, 500, 1]);
  assert.deepEqual(judged[0][1][0], { id: 1, ...verdict }, "each memory's id and verdict, and nothing else, reach the CLI");
  assert.deepEqual((await readMemory(HOME, 1)).verdict, verdict);
});

test("free copies save through the CLI, refused before it unless a whole number, on the owner's attended key", async () => {
  const { setFreeCopies } = require("../../src/state.cjs");
  const calls = fakeCli();
  for (const bad of [-1, 1.5, "4", Number.NaN]) await assert.rejects(setFreeCopies(HOME, bad), { message: /whole number/ });
  assert.equal(calls.length, 0, "a bad count never reaches the CLI");
  await setFreeCopies(HOME, 0);
  await setFreeCopies(HOME, 5);
  assert.deepEqual(calls.map((call) => [call.args, call.input]), [[["free-copies", "0"], ""], [["free-copies", "5"], ""]]);
  assert.match(String(calls[0].env.LORE_ATTENDED_KEY), /^[0-9a-f]{64}$/, "the owner set it in the app, so the call carries this launch's key");
  assert.equal(calls[0].env.LORE_HOME, HOME);
});

/** A stand-in CLI: answers the snapshot with a price, free copies, the store's payout address, whether it sells and its
 * pieces, and whether it is the store this Lore ships, and card payments; every other call prints "Done".
 * @param {string | null} payout @param {{selling?: boolean, items?: Partial<PublicationItem>[], cards?: string, store?: "current" | "outdated" | "unknown", url?: string | null}} [store] */
function storeCli(payout, { selling = false, items = [], cards = "", store = "unknown", url = "https://lore.example.workers.dev/mcp" } = {}) {
  const state = { version: 1, publications: { counts: { active: items.length, revoked: 0 }, items }, pricing: { publication_usd: 1.5, answer_usd: null, answer_enabled: false, free_copies: 3 }, node: { url, selling, store, live: { state: "online", network: "eip155:8453", price_usd: 1.5, payout } } };
  // `cards` is the Stripe account card payments go to, "" when they're off.
  const taking = { account: cards, pending: "", ready: cards ? true : null, checking: false, minimum_usd: 0.5 };
  const calls = fakeCli((args) => (args[0] === "desktop-state" ? json(state) : args[0] === "cards" ? json(taking) : { stdout: "Done\n" }));
  return { calls, ran: () => logged(calls) };
}

/** Where the store's last deploy recorded its payout, in the store's own folder; null clears it. @param {{address: string | null, network: string} | null} payout */
async function recordPayout(payout) {
  const file = join(process.env.LORE_STORE ?? "", "payout.json");
  if (payout) await writeFile(file, JSON.stringify(payout));
  else await rm(file, { force: true });
}

/** APP-226: the owner's card for a store update, answered `yes`, recording what it listed. @param {boolean} yes @param {Array<{heading: string, changes: StoreChange[]}>} seen */
function confirming(yes, seen) {
  const { Outgoing } = require("../../src/state.cjs");
  return new Outgoing(HOME, async (heading, changes) => { seen.push({ heading, changes }); return yes; });
}

test("the store opens only after the owner confirms each change: the pieces, the price and free copies, the network and the whole address", async () => {
  const { openStore, dollars } = require("../../src/state.cjs");
  assert.equal(dollars.format(0.000001), "$0.000001", "a price below a cent reads as itself on the card the owner confirms");
  assert.equal(dollars.format(1.5), "$1.50");
  const { ran } = storeCli(null, { items: [{ id: 1, title: "Price the first tier low", state: "approved", live: false }] });
  const wallet = `0x${"ab12".repeat(9)}c0de`;
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  const ask = async () => ({});
  await recordPayout(null);
  assert.match(await openStore(HOME, { network: "real", wallet }, ask, confirming(false, seen)), /chose not to/);
  assert.equal(ran(), "", "nothing ran without a yes");
  assert.deepEqual(seen[0], {
    heading: "Open your store",
    changes: [
      { group: "Going on sale", label: "Price the first tier low" },
      { group: "", label: "Price", to: "$1.50 a piece" },
      { group: "", label: "Free copies", to: "The first 3 of each piece" },
      { group: "", label: "Payments", to: "Real money" },
      { group: "", label: "Paid to", to: `0x ${"ab12 ".repeat(9)}c0de` }
    ]
  });
  assert.match(await openStore(HOME, { network: "real", wallet: "0x123" }, ask, confirming(true, seen)), /not valid/);
  assert.match(await openStore(HOME, { network: /** @type {"real"} */ ("main"), wallet }, ask, confirming(true, seen)), /real money or the test network/);
  assert.equal(seen.length, 1, "a bad address or network never reaches the owner");
  assert.match(await openStore(HOME, { network: "real", wallet }, ask, confirming(true, seen)), /deployed/);
  assert.equal(ran(), `node deploy --network real --wallet ${wallet} unattended=1 stdin=\n`);
});

test("putting the store online for the owner's agents asks one yes, and never a network, payout or price", async () => {
  const { openStore } = require("../../src/state.cjs");
  const { ran } = storeCli(null);
  /** @type {OwnerQuestion[][]} */
  const asked = [];
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  const answer = (/** @type {string} */ label) => async (/** @type {OwnerQuestion[]} */ questions) => { asked.push(questions); return { [questions[0].question]: label }; };
  await recordPayout(null);
  assert.match(await openStore(HOME, { inboxOnly: true }, answer("Not now"), confirming(true, seen)), /chose not to/);
  assert.equal(ran(), "", "nothing ran without a yes");
  assert.equal(asked[0][0].question, "Put your store online so your agents can save to it? Nothing goes on sale.");
  assert.match(await openStore(HOME, { inboxOnly: true }, answer("Put it online"), confirming(true, seen)), /deployed/);
  assert.equal(ran(), "node deploy --inbox-only unattended=1 stdin=\n");
  assert.equal(asked.length, 2, "one card each time, and nothing else asked");
  assert.equal(seen.length, 0, "nothing goes on sale, so there is no change to confirm");
});

test("with no store of their own, the owner's agents get one Lore hosts, on one yes and in seconds (XC-088)", async () => {
  const { openStore } = require("../../src/state.cjs");
  const { ran } = storeCli(null, { url: null });
  /** @type {OwnerQuestion[][]} */
  const asked = [];
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  const answer = (/** @type {string} */ label) => async (/** @type {OwnerQuestion[]} */ questions) => { asked.push(questions); return { [questions[0].question]: label }; };
  assert.match(await openStore(HOME, { inboxOnly: true }, answer("Not now"), confirming(true, seen)), /chose not to/);
  assert.equal(ran(), "", "nothing ran without a yes");
  assert.equal(await openStore(HOME, { inboxOnly: true }, answer("Put it online"), confirming(true, seen)), "The store is online for the owner's agents, hosted by Lore: nothing for sale.");
  assert.equal(ran(), "node host unattended= stdin=\n");
  assert.match(JSON.stringify(asked[1]), /Takes a few seconds/);
  assert.equal(seen.length, 0, "nothing goes on sale, so there is no change to confirm");
});

/** A stand-in CLI for an owner with a store on their own Cloudflare, whose deploy fails as `failing` says on stderr,
 * unless it names an account; it lists two accounts. @param {string} failing */
function failingCli(failing) {
  const state = { version: 1, publications: { counts: { active: 0, revoked: 0 }, items: [] }, pricing: { publication_usd: null, answer_usd: null, answer_enabled: false, free_copies: 3 }, node: { url: "https://lore.example.workers.dev/mcp", selling: false, store: "unknown", live: { state: "not_configured" } } };
  const accounts = [{ id: "0".repeat(32), name: "Ada's Account" }, { id: "f".repeat(32), name: "Lab" }];
  const calls = fakeCli((args) => {
    if (args[0] === "desktop-state") return json(state);
    if (args[1] === "accounts") return json(accounts);
    if (args.includes("--account")) return { stdout: "Online\n" };
    return { stderr: `${failing}\n`, code: 1 };
  });
  return { ran: () => calls.filter((call) => call.args[0] !== "desktop-state" && call.args[1] !== "accounts").map((call) => `${call.args.join(" ")}\n`).join("") };
}

test("a store that didn't go online says why, in the CLI's words, and where the rest is (XC-085)", async () => {
  const { openStore } = require("../../src/state.cjs");
  const yes = async (/** @type {OwnerQuestion[]} */ questions) => ({ [questions[0].question]: "Put it online" });
  for (const [failing, why] of [
    ["lore: Cloudflare needs you to verify your email first. Check your inbox for their email, click the link, then tap Set it up again.", "The deploy did not finish: Cloudflare needs you to verify your email first. Check your inbox for their email, click the link, then tap Set it up again."],
    ["lore: deploy failed:\n✘ [ERROR] Something Cloudflare never said before", "The deploy did not finish: deploy failed: ✘ [ERROR] Something Cloudflare never said before."]
  ]) {
    failingCli(failing);
    const said = (await openStore(HOME, { inboxOnly: true }, yes, confirming(true, []))).split("\n");
    assert.equal(said[0], why);
    assert.equal(said.at(-1), `Everything Cloudflare said is in ${join(HOME, "logs", "store.log")}.`);
  }
});

test("a Cloudflare sign-in with two accounts asks which one, then puts the store there (XC-087)", async () => {
  const { openStore } = require("../../src/state.cjs");
  const { ran } = failingCli("lore: Your Cloudflare sign-in has more than one account. Choose the one your store goes on (`lore node accounts`), then set it up again.");
  /** @type {OwnerQuestion[][]} */
  const asked = [];
  const answer = (/** @type {string} */ label) => async (/** @type {OwnerQuestion[]} */ questions) => {
    asked.push(questions);
    return { [questions[0].question]: questions[0].question.startsWith("Which") ? label : "Put it online" };
  };
  assert.match(await openStore(HOME, { inboxOnly: true }, answer("Lab"), confirming(true, [])), /^The store is deployed/);
  const picker = asked.at(-1)?.[0];
  assert.equal(picker?.question, "Which Cloudflare account should your store go on?");
  assert.deepEqual(picker?.options.map((option) => option.label), ["Ada's Account", "Lab"]);
  assert.equal(ran(), `node deploy --inbox-only\nnode deploy --inbox-only --account ${"f".repeat(32)}\n`);
  assert.match(await openStore(HOME, { inboxOnly: true }, answer(""), confirming(true, [])), /didn't choose a Cloudflare account/);
});

test("Update store puts out the newer store Lore ships, on its card, as the store was last opened; a decision's push never does (APP-231)", async () => {
  const wallet = `0x${"ab12".repeat(9)}c0de`;
  const latest = { group: "", label: "Store", to: "The latest from Lore" };
  /** @param {Parameters<typeof storeCli>[1]} store @param {{address: string | null, network: string} | null} payout */
  const outdated = async (store, payout) => {
    const cli = storeCli(null, store);
    await recordPayout(payout);
    /** @type {Array<{heading: string, changes: StoreChange[]}>} */
    const seen = [];
    return { seen, ran: cli.ran, clear: () => cli.calls.splice(0), outgoing: (/** @type {boolean} */ yes) => confirming(yes, seen) };
  };
  try {
    // A store for sale, on real money to an address: a decision's push puts out only what it decided.
    const sale = await outdated({ selling: true, store: "outdated" }, { address: wallet, network: "real" });
    assert.equal(await sale.outgoing(true).push(), true);
    assert.equal(sale.ran(), "push unattended= stdin=\n");
    assert.equal(sale.seen.length, 0, "nothing to ask: nothing it decided needs a yes");
    // The owner's Update store asks first, naming the newer store, and nothing goes out on a no.
    sale.clear();
    assert.equal(await sale.outgoing(false).push({ latest: true }), false);
    assert.deepEqual(sale.seen, [{ heading: "Update your store", changes: [latest] }]);
    assert.equal(sale.ran(), "", "a cancelled update puts nothing out");
    assert.equal(await sale.outgoing(true).push({ latest: true }), true);
    assert.equal(sale.ran(), `node deploy --network real --wallet ${wallet} unattended=1 stdin=\n`);
    // One that sells by card alone goes out on its network, with no address.
    const cards = await outdated({ selling: true, store: "outdated" }, { address: null, network: "real" });
    assert.equal(await cards.outgoing(true).push({ latest: true }), true);
    assert.equal(cards.ran(), "node deploy --network real unattended=1 stdin=\n");
    // One online only for its agents goes out the same way it was put online.
    const agents = await outdated({ selling: false, store: "outdated" }, null);
    assert.equal(await agents.outgoing(true).push({ latest: true }), true);
    assert.equal(agents.ran(), "node deploy --inbox-only unattended=1 stdin=\n");
    assert.deepEqual(agents.seen, [{ heading: "Update your store", changes: [latest] }]);
    // Already the store this Lore ships, or one this Mac has no record of putting online: nothing to put out.
    for (const store of /** @type {const} */ (["current", "unknown"])) {
      const quiet = await outdated({ selling: false, store }, null);
      assert.equal(await quiet.outgoing(true).push({ latest: true }), false, store);
      assert.equal(quiet.ran(), "", store);
      assert.equal(quiet.seen.length, 0, store);
    }
  } finally {
    await recordPayout(null);
  }
});

test("a store that sells puts a waiting piece out only once the owner confirms it, even going online for its agents", async () => {
  const { openStore } = require("../../src/state.cjs");
  const { ran } = storeCli(null, { selling: true, items: [{ id: 2, title: "Hire management first", state: "approved", live: false }] });
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  const ask = async () => { throw new Error("the plain card is not for a store with changes waiting"); };
  assert.match(await openStore(HOME, { inboxOnly: true }, ask, confirming(false, seen)), /chose not to/);
  assert.equal(ran(), "");
  assert.deepEqual(seen, [{ heading: "Update your store", changes: [{ group: "Going on sale", label: "Hire management first" }] }]);
  const outgoing = confirming(false, seen);
  assert.equal(await outgoing.push(), false);
  assert.equal(ran(), "", "a cancelled update pushes nothing");
  const yes = confirming(true, seen);
  assert.equal(await yes.push(), true);
  assert.equal(ran(), "push unattended= stdin=\n");
});

test("a store update lists each piece and term it changes, and only taking pieces down goes out unasked", () => {
  const { storeChanges } = require("../../src/state.cjs");
  /** @param {Partial<Snapshot["node"]>} node @param {PublicationItem[]} items @returns {Snapshot} */
  const state = (node, items) => /** @type {Snapshot} */ (/** @type {unknown} */ ({
    publications: { counts: { active: 0, revoked: 0 }, items },
    pricing: { publication_usd: 0.75, answer_usd: null, answer_enabled: false, free_copies: 0 },
    node: { url: "https://lore.example.workers.dev/mcp", selling: true, live: { state: "online", network: "eip155:8453", price_usd: 0.02, payout: null }, ...node }
  }));
  const piece = (/** @type {number} */ id, /** @type {string} */ title, /** @type {"approved" | "revoked"} */ status, /** @type {boolean | null} */ live) => ({ id, public_id: `p${id}`, title, topic: "", state: status, live });
  const items = [piece(1, "New", "approved", false), piece(2, "Samples changed", "approved", true), piece(3, "Taken down", "revoked", true), piece(4, "Unchanged", "approved", true), piece(5, "Unknown", "approved", null)];
  assert.deepEqual(storeChanges(state({}, items), [2]), [
    { group: "Going on sale", label: "New" },
    { group: "Updated", label: "Samples changed" },
    { group: "Coming off", label: "Taken down" },
    { group: "", label: "Price", from: "$0.02 a piece", to: "$0.75 a piece" }
  ]);
  assert.deepEqual(storeChanges(state({ live: { state: "online", network: null, price_usd: 0.75, payout: null } }, [piece(3, "Taken down", "revoked", true)])), [{ group: "Coming off", label: "Taken down" }]);
  assert.deepEqual(storeChanges(state({ selling: false }, items)), [], "a store that sells nothing puts no piece out");
  const recorded = { address: `0x${"5e11".repeat(10)}`, network: /** @type {const} */ ("test") };
  assert.deepEqual(storeChanges(state({ live: { state: "online", network: null, price_usd: 0.75, payout: null } }, []), [], { network: "real", payout: `0x${"7777".repeat(10)}`, recorded }), [
    { group: "", label: "Payments", from: "Test network", to: "Real money" },
    { group: "", label: "Paid to", from: `0x ${"5e11 ".repeat(9)}5e11`, to: `0x ${"7777 ".repeat(9)}7777` }
  ]);
  const opening = storeChanges(state({ url: null, selling: false }, [piece(4, "Unchanged", "approved", null)]), [], { network: "test", payout: `0x${"7777".repeat(10)}`, recorded: null });
  assert.deepEqual(opening.map((change) => change.label), ["Unchanged", "Price", "Free copies", "Payments", "Paid to", "Address"]);
});

test("a redeploy pays where the store's own record says, whatever Lore's database claims, and deploys exactly that", async () => {
  const { openStore } = require("../../src/state.cjs");
  // The snapshot (from lore.db, which the agent can write) names a different address.
  const forged = `0x${"bad0".repeat(10)}`;
  const { ran } = storeCli(forged, { selling: true });
  const recorded = `0x${"5e11".repeat(9)}f00d`;
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  try {
    await recordPayout({ address: recorded, network: "test" });
    const said = await openStore(HOME, {}, async () => ({}), confirming(false, seen));
    assert.match(said, /deployed/);
    assert.equal(seen.length, 0, "a redeploy that changes nothing goes ahead without a card");
    assert.equal(ran(), `node deploy --network test --wallet ${recorded} unattended=1 stdin=\n`);
  } finally {
    await recordPayout(null);
  }
});

test("a new address where the store already pays somewhere is shown as a change, naming both", async () => {
  const { openStore } = require("../../src/state.cjs");
  const { ran } = storeCli(null, { selling: true });
  const recorded = `0x${"5e11".repeat(9)}f00d`;
  const next = `0x${"7777".repeat(10)}`;
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  try {
    await recordPayout({ address: recorded, network: "real" });
    assert.match(await openStore(HOME, { wallet: next }, async () => ({}), confirming(false, seen)), /chose not to/);
    assert.equal(ran(), "");
    assert.match(await openStore(HOME, { wallet: next }, async () => ({}), confirming(true, seen)), /deployed/);
    assert.deepEqual(seen[0], { heading: "Change where your sales are paid", changes: [{ group: "", label: "Paid to", from: `0x ${"5e11 ".repeat(9)}f00d`, to: `0x ${"7777 ".repeat(9)}7777` }] });
    // The same address, in any case, is no change.
    assert.match(await openStore(HOME, { wallet: recorded.toUpperCase().replace("0X", "0x") }, async () => ({}), confirming(false, seen)), /deployed/);
    assert.equal(seen.length, 2);
    assert.equal(ran(), `node deploy --network real --wallet ${next} unattended=1 stdin=\nnode deploy --network real --wallet ${recorded.toUpperCase().replace("0X", "0x")} unattended=1 stdin=\n`);
  } finally {
    await recordPayout(null);
  }
});

test("a store left half-changed is said plainly in the desktop result, with no setting names", async () => {
  const { openStore } = require("../../src/state.cjs");
  const state = { version: 1, publications: { counts: { active: 0, revoked: 0 }, items: [] }, pricing: { publication_usd: 1.5, answer_usd: null, answer_enabled: false, free_copies: 0 }, node: { url: "https://lore.example.workers.dev/mcp", selling: true, live: { state: "online", network: null, price_usd: 1.5, payout: null } } };
  const next = `0x${"7777".repeat(10)}`;
  // The CLI as it ends when the wallet changed, the network did not, and the old wallet could not go back.
  fakeCli((args) => (args[0] === "desktop-state" ? json(state) : { stderr: `! Your store may be half-updated: it now pays ${next} on its old network. Open your store again to finish.\nlore: Lore couldn't switch your store's network:\nvault down\n`, code: 1 }));
  try {
    await recordPayout({ address: `0x${"5e11".repeat(10)}`, network: "test" });
    const said = await openStore(HOME, { network: "real", wallet: next }, async () => ({}), confirming(true, []));
    // XC-085: the why on the line after the CLI's own is kept, not dropped.
    assert.equal(said, `The deploy did not finish: Lore couldn't switch your store's network: vault down.\nYour store may be half-updated: it now pays ${next} on its old network. Open your store again to finish.\nEverything Cloudflare said is in ${join(HOME, "logs", "store.log")}.`);
    assert.ok(!said.includes("LORE_"));
  } finally {
    await recordPayout(null);
  }
});

test("a redeploy with no payout on record asks the owner on the app's own card, never guesses", async () => {
  const { openStore } = require("../../src/state.cjs");
  const { ran } = storeCli(`0x${"bad0".repeat(10)}`);
  const typed = `0x${"7777".repeat(10)}`;
  /** @type {OwnerQuestion[][]} */
  const asked = [];
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  await recordPayout(null);
  // Nothing typed: nothing opens.
  assert.match(await openStore(HOME, { network: "real" }, async (questions) => { asked.push(questions); return {}; }, confirming(true, seen)), /no payout address/);
  assert.equal(asked[0][0].format, "evm_address");
  assert.equal(ran(), "");
  const said = await openStore(HOME, { network: "real" }, async (questions) => {
    asked.push(questions);
    return { [questions[0].question]: typed };
  }, confirming(true, seen));
  assert.match(said, /deployed/);
  assert.deepEqual(seen.at(-1)?.changes.find((change) => change.label === "Paid to"), { group: "", label: "Paid to", to: `0x ${"7777 ".repeat(9)}7777` });
  assert.equal(ran(), `node deploy --network real --wallet ${typed} unattended=1 stdin=\n`);
  // And with neither a network asked nor one on record, it says so instead of picking.
  assert.match(await openStore(HOME, {}, async () => ({}), confirming(true, seen)), /Say which network/);
});

test("with card payments on, a store opens selling by card alone: no address asked, none deployed", async () => {
  const { openStore } = require("../../src/state.cjs");
  const { ran } = storeCli(null, { cards: "acct_1Seller", items: [{ id: 1, title: "Price the first tier low", state: "approved", live: false }] });
  /** @type {OwnerQuestion[][]} */
  const asked = [];
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  await recordPayout(null);
  const said = await openStore(HOME, {}, async (questions) => { asked.push(questions); return {}; }, confirming(true, seen));
  assert.match(said, /deployed/);
  assert.deepEqual(asked, [], "no network and no address asked");
  assert.deepEqual(seen[0].changes.filter((change) => change.group === ""), [
    { group: "", label: "Price", to: "$1.50 a piece" },
    { group: "", label: "Free copies", to: "The first 3 of each piece" },
    { group: "", label: "Payments", to: "By card" },
    { group: "", label: "Paid to", to: "Your bank, through Stripe" }
  ]);
  assert.equal(ran(), "node deploy --network real unattended=1 stdin=\n");
});

test("on the payout card, By card opens the store only once card payments are really on", async () => {
  const { openStore } = require("../../src/state.cjs");
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  /** @param {OwnerQuestion[]} questions */
  const byCard = async (questions) => ({ [questions[0].question]: "By card" });
  const off = storeCli(null);
  await recordPayout(null);
  assert.match(await openStore(HOME, { network: "real" }, byCard, confirming(true, seen)), /Card payments aren't on yet/);
  assert.equal(off.ran(), "");
});

test("the profile saves only after the owner sees every part of it in full", async () => {
  const { saveProfile } = require("../../src/state.cjs");
  const { ran } = storeCli(null);
  const long = "Keep out ".repeat(60).trim();
  const profile = { role: "Founder", boundaries: long, cadence: "weekly", day: 6, hour: 21, executor: "lore" };
  /** @type {OwnerQuestion[]} */
  const asked = [];
  const answer = (/** @type {string} */ label) => async (/** @type {OwnerQuestion[]} */ questions) => { asked.push(questions[0]); return { [questions[0].question]: label }; };
  assert.match(await saveProfile(HOME, profile, answer("Not now")), /chose not to/);
  assert.equal(ran(), "");
  assert.equal(asked[0].question, "Save this profile?");
  assert.equal(asked[0].detail, `Lore reads your apps every Sunday at 9 PM.\n\nRole: Founder\n\nKeep out: ${long}`);
  await saveProfile(HOME, profile, answer("Save it"));
  assert.equal(ran(), `profile - unattended= stdin=${JSON.stringify(profile)}\n`);
});

test("memory reads validate the id before any CLI call, and say when it is unknown", async (t) => {
  t.mock.method(console, "error", () => {});
  const { readMemory } = require("../../src/state.cjs");
  const calls = fakeCli(() => refused("memory not found: 999"));
  for (const bad of [0, -1, 1.5, "1", null]) await assert.rejects(readMemory("/nonexistent", bad), { message: /Invalid memory/ });
  assert.equal(calls.length, 0, "a bad id never reaches the CLI");
  await assert.rejects(readMemory(HOME, 999), { message: /memory not found: 999/ });
  assert.deepEqual(calls.map((call) => call.args), [["memory", "show", "999", "--json"]]);
});

test("memory rename validates the id and title before any CLI call, and round-trips through the CLI", async (t) => {
  t.mock.method(console, "error", () => {});
  const { renameMemory } = require("../../src/state.cjs");
  const calls = fakeCli((args) => (args[2] === "999" ? refused("memory not found: 999") : json({ id: Number(args[2]), title: args[3] })));
  for (const bad of [0, -1, 1.5, "1", null]) await assert.rejects(renameMemory("/nonexistent", bad, "New title"), { message: /Invalid memory/ });
  await assert.rejects(renameMemory(HOME, 1, "   "), { message: /Title cannot be empty/ });
  assert.equal(calls.length, 0, "nothing invalid reaches the CLI");
  await assert.rejects(renameMemory(HOME, 999, "New title"), { message: /memory not found: 999/ });
  assert.deepEqual(await renameMemory(HOME, 2, "  New title "), { id: 2, title: "New title" });
  assert.deepEqual(calls.at(-1)?.args, ["memory", "rename", "2", "New title", "--json"]);
});

test("memory edit validates the id and content before any CLI call, and round-trips through the CLI", async (t) => {
  t.mock.method(console, "error", () => {});
  const { editMemory } = require("../../src/state.cjs");
  const calls = fakeCli((args, { input }) => (args[2] === "999" ? refused("memory not found: 999") : json({ id: Number(args[2]), content: input })));
  for (const bad of [0, -1, 1.5, "1", null]) await assert.rejects(editMemory("/nonexistent", bad, "New content"), { message: /Invalid memory/ });
  await assert.rejects(editMemory(HOME, 1, "   "), { message: /Content cannot be empty/ });
  await assert.rejects(editMemory(HOME, 999, "New content"), { message: /memory not found: 999/ });
  for (const content of ["-solo", "--json", "---\n- one\n- two"]) {
    assert.equal((await editMemory(HOME, 1, content)).content, content, "content that looks like an option must still be content");
    assert.deepEqual(calls.at(-1)?.args, ["memory", "edit", "1", "--stdin", "--json"], "it goes over stdin, never argv");
  }
});

test("memory delete validates the id before any CLI call, and removes the memory through the CLI", async (t) => {
  t.mock.method(console, "error", () => {});
  const { deleteMemory } = require("../../src/state.cjs");
  const calls = fakeCli((args) => (args[2] === "999" ? refused("memory not found: 999") : json({ deleted: Number(args[2]) })));
  for (const bad of [0, -1, 1.5, "1", null]) await assert.rejects(deleteMemory("/nonexistent", bad), { message: /Invalid memory/ });
  await assert.rejects(deleteMemory(HOME, 999), { message: /memory not found: 999/ });
  assert.deepEqual(await deleteMemory(HOME, 4), { deleted: 4 });
  assert.deepEqual(calls.map((call) => call.args), [["memory", "delete", "999", "--json"], ["memory", "delete", "4", "--json"]]);
});

test("report feedback validates before any CLI call, and sends adversarial content to the CLI as literal text", async () => {
  const { reportFeedback } = require("../../src/state.cjs");
  const calls = fakeCli(() => json({ url: "https://github.com/dipakkrishnan/lore-mcp/issues/1", number: 1 }));
  await assert.rejects(reportFeedback("/nonexistent", { title: "", email: "", description: "d" }), { message: /Title cannot be empty/ });
  await assert.rejects(reportFeedback("/nonexistent", { title: "t", email: "", description: "   " }), { message: /Description cannot be empty/ });
  assert.equal(calls.length, 0);
  // A title/description that look like CLI flags must still arrive as literal text: this is exactly the case
  // --title=VALUE (not --title VALUE) and stdin (not argv) exist to protect against. The CLI's own parse of this argv,
  // and the relay labelling it desktop, are tests/test_cli.py's and tests/test_feedback.py's.
  const receipt = await reportFeedback(HOME, { title: "--json", email: "weird--flag@x.com", description: "--not-a-flag\nmulti line" });
  assert.deepEqual(receipt, { url: "https://github.com/dipakkrishnan/lore-mcp/issues/1", number: 1 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ["report-feedback", "--title=--json", "--description-file", "-", "--json", "--email=weird--flag@x.com"]);
  assert.equal(calls[0].input, "--not-a-flag\nmulti line");
});

test("report feedback omits --email entirely when none is given", async () => {
  const { reportFeedback } = require("../../src/state.cjs");
  const calls = fakeCli(() => json({ url: "https://github.com/dipakkrishnan/lore-mcp/issues/2", number: 2 }));
  await reportFeedback(HOME, { title: "No email", email: "  ", description: "details" });
  assert.ok(!calls[0].args.some((arg) => arg.startsWith("--email")), JSON.stringify(calls[0].args));
});

test("a CLI refusal explained over several lines reaches the owner as its Reason line", async (t) => {
  const { lore } = require("../../src/state.cjs");
  t.mock.method(console, "error", () => {});
  const file = join(HOME, "automation", "profile.json");
  const schedule = () => lore(HOME, ["profile", file]);
  // No profile yet: a one-line refusal comes through as it is.
  fakeCli(() => refused(`[Errno 2] No such file or directory: '${file}'`));
  await assert.rejects(schedule(), { message: /No such file|profile\.json/ });
  // A rhythm saved without a model: the CLI keeps the profile and explains over several lines, as it does
  // (tests/test_automation.py); the owner hears the Reason line, not "Then run: env ...".
  fakeCli(() => ({
    stdout: `✓ Saved profile to ${file}\n`,
    stderr: `! Saved the profile, but the  schedule was not installed.\n  Reason: '' is not a valid Agent\n  Fix: Resolve the error above, then reinstall the schedule.\n  Then run: env LORE_HOME=${HOME} python -m lore profile ${file}\n`,
    code: 1
  }));
  await assert.rejects(schedule(), (error) => /^'' is not a valid Agent$/.test(/** @type {Error} */ (error).message));
  // With nothing on stderr at all, the owner still hears something.
  fakeCli(() => ({ code: 1 }));
  await assert.rejects(schedule(), { message: "Lore could not finish that" });
});

test("the price action refuses anything but a positive number, and saves through the CLI", async () => {
  const { setPrice } = require("../../src/state.cjs");
  const calls = fakeCli();
  // Rejected before any CLI call.
  for (const bad of [0, -1, NaN, Infinity, "0.01", null, undefined]) {
    await assert.rejects(setPrice("/nonexistent", bad), { message: /A price has to be a number above zero/ }, String(bad));
  }
  assert.equal(calls.length, 0);
  await setPrice(HOME, 0.25);
  // Sub-cent prices are legal all the way down to the deploy floor.
  await setPrice(HOME, 0.000001);
  assert.deepEqual(calls.map((call) => [call.args, call.input]), [[["price", "0.25"], ""], [["price", "0.000001"], ""]]);
});
