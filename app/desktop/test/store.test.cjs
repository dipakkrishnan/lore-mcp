// The store and the CLI round-trips: opening, updating and paying out a store, and the memory, feedback and price actions.
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

test("crediting a big reading goes to the CLI in batches it takes", async () => {
  const { creditMemories } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const ids = Array.from({ length: 1001 }, (_, i) => i + 1);
    await creditMemories(directory, ids, { kind: "routine", id: "r1", label: "Sunday", mark: "clock" });
    await creditMemories(directory, [], { kind: "routine", id: "r1", label: "Sunday", mark: "clock" });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("what a reading judged of a memory reaches its sheet and Inventory, so Draft for sale shows only where it makes sense", async () => {
  const { judgeMemories, captureMemories, readMemory } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    const [saved] = await captureMemories(directory, [{ title: "Travel preferences", content: "Window seat, United or American, diving and poke." }]);
    assert.equal((await readMemory(directory, saved.id)).verdict, null, "a memory no reading judged offers Draft for sale as before");
    await judgeMemories(directory, []);
    await judgeMemories(directory, [{ id: saved.id, title: "Travel preferences", sell: false, work: false, why: "a personal preference" }, ...Array.from({ length: 1000 }, (_, i) => ({ id: saved.id + i + 1, title: "", sell: true, work: false, why: "" }))]);
    const verdict = { sell: false, work: false, why: "a personal preference" };
    assert.deepEqual((await readMemory(directory, saved.id)).verdict, verdict);
    assert.deepEqual((await readState(directory)).library.items.map((item) => item.verdict), [verdict]);
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("free copies save through the CLI, refused before it unless a whole number, and read back in the snapshot", async () => {
  const { setFreeCopies } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    assert.equal((await readState(directory)).pricing.free_copies, 3);
    for (const bad of [-1, 1.5, "4", Number.NaN]) await assert.rejects(setFreeCopies(directory, bad), { message: /whole number/ });
    await setFreeCopies(directory, 0);
    assert.equal((await readState(directory)).pricing.free_copies, 0);
    await setFreeCopies(directory, 5);
    assert.equal((await readState(directory)).pricing.free_copies, 5);
  } finally {
    await rm(directory, { recursive: true });
  }
});

/** A stand-in CLI: answers the snapshot with a price, free copies, the store's payout address, whether it sells and its
 * pieces, and whether it is the store this Lore ships, and records every other call with its stdin.
 * @param {string} directory @param {string | null} payout @param {{selling?: boolean, items?: Partial<PublicationItem>[], cards?: string, store?: "current" | "outdated" | "unknown"}} [store] */
async function recordingCli(directory, payout, { selling = false, items = [], cards = "", store = "unknown" } = {}) {
  const fake = join(directory, "lore");
  const ran = join(directory, "ran");
  const state = JSON.stringify({ version: 1, publications: { counts: { active: items.length, revoked: 0 }, items }, pricing: { publication_usd: 1.5, answer_usd: null, answer_enabled: false, free_copies: 3 }, node: { url: "https://lore.example.workers.dev/mcp", selling, store, live: { state: "online", network: "eip155:8453", price_usd: 1.5, payout } } });
  // `cards` is the Stripe account card payments go to, "" when they're off.
  const taking = JSON.stringify({ account: cards, pending: "", ready: cards ? true : null, checking: false, minimum_usd: 0.5 });
  await writeFile(fake, `#!/bin/sh\nif [ "$1" = desktop-state ]; then echo '${state}'; exit 0; fi\nif [ "$1" = cards ]; then echo '${taking}'; exit 0; fi\necho "$* unattended=$LORE_UNATTENDED stdin=$([ "$1" = profile ] && cat)" >> ${JSON.stringify(ran)}\necho "Done"\n`, { mode: 0o755 });
  return { fake, ran };
}

/** Where the store's last deploy recorded its payout, in the store's own folder; null clears it. @param {{address: string | null, network: string} | null} payout */
async function recordPayout(payout) {
  const file = join(process.env.LORE_STORE ?? "", "payout.json");
  if (payout) await writeFile(file, JSON.stringify(payout));
  else await rm(file, { force: true });
}

/** APP-226: the owner's card for a store update, answered `yes`, recording what it listed. @param {string} directory @param {boolean} yes @param {Array<{heading: string, changes: StoreChange[]}>} seen */
function confirming(directory, yes, seen) {
  const { Outgoing } = require("../src/state.cjs");
  return new Outgoing(directory, async (heading, changes) => { seen.push({ heading, changes }); return yes; });
}

test("the store opens only after the owner confirms each change: the pieces, the price and free copies, the network and the whole address", async () => {
  const { openStore, useRuntime, dollars } = require("../src/state.cjs");
  assert.equal(dollars.format(0.000001), "$0.000001", "a price below a cent reads as itself on the card the owner confirms");
  assert.equal(dollars.format(1.5), "$1.50");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const { fake, ran } = await recordingCli(directory, null, { items: [{ id: 1, title: "Price the first tier low", state: "approved", live: false }] });
  const wallet = `0x${"ab12".repeat(9)}c0de`;
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  const ask = async () => ({});
  try {
    useRuntime(fake);
    await recordPayout(null);
    assert.match(await openStore(directory, { network: "real", wallet }, ask, confirming(directory, false, seen)), /chose not to/);
    assert.ok(!existsSync(ran), "nothing ran without a yes");
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
    assert.match(await openStore(directory, { network: "real", wallet: "0x123" }, ask, confirming(directory, true, seen)), /not valid/);
    assert.match(await openStore(directory, { network: /** @type {"real"} */ ("main"), wallet }, ask, confirming(directory, true, seen)), /real money or the test network/);
    assert.equal(seen.length, 1, "a bad address or network never reaches the owner");
    assert.match(await openStore(directory, { network: "real", wallet }, ask, confirming(directory, true, seen)), /deployed/);
    assert.equal(await readFile(ran, "utf8"), `node deploy --network real --wallet ${wallet} unattended=1 stdin=\n`);
  } finally {
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

test("putting the store online for the owner's agents asks one yes, and never a network, payout or price", async () => {
  const { openStore, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const { fake, ran } = await recordingCli(directory, null);
  /** @type {OwnerQuestion[][]} */
  const asked = [];
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  const answer = (/** @type {string} */ label) => async (/** @type {OwnerQuestion[]} */ questions) => { asked.push(questions); return { [questions[0].question]: label }; };
  try {
    useRuntime(fake);
    await recordPayout(null);
    assert.match(await openStore(directory, { inboxOnly: true }, answer("Not now"), confirming(directory, true, seen)), /chose not to/);
    assert.ok(!existsSync(ran), "nothing ran without a yes");
    assert.equal(asked[0][0].question, "Put your store online so your agents can save to it? Nothing goes on sale.");
    assert.match(await openStore(directory, { inboxOnly: true }, answer("Put it online"), confirming(directory, true, seen)), /deployed/);
    assert.equal(await readFile(ran, "utf8"), "node deploy --inbox-only unattended=1 stdin=\n");
    assert.equal(asked.length, 2, "one card each time, and nothing else asked");
    assert.equal(seen.length, 0, "nothing goes on sale, so there is no change to confirm");
  } finally {
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

/** A stand-in CLI whose deploy fails as `failing` says on stderr, unless it names an account; it lists two accounts.
 * @param {string} directory @param {string} failing */
async function failingCli(directory, failing) {
  const fake = join(directory, "lore");
  const ran = join(directory, "ran");
  const said = join(directory, "failing");
  await writeFile(said, `${failing}\n`);
  const state = JSON.stringify({ version: 1, publications: { counts: { active: 0, revoked: 0 }, items: [] }, pricing: { publication_usd: null, answer_usd: null, answer_enabled: false, free_copies: 3 }, node: { url: null, selling: false, store: "unknown", live: { state: "not_configured" } } });
  const accounts = join(directory, "accounts.json");
  await writeFile(accounts, JSON.stringify([{ id: "0".repeat(32), name: "Ada's Account" }, { id: "f".repeat(32), name: "Lab" }]));
  await writeFile(fake, `#!/bin/sh
if [ "$1" = desktop-state ]; then echo '${state}'; exit 0; fi
if [ "$2" = accounts ]; then cat ${JSON.stringify(accounts)}; exit 0; fi
echo "$*" >> ${JSON.stringify(ran)}
case "$*" in *--account*) echo "Online"; exit 0;; esac
cat ${JSON.stringify(said)} >&2
exit 1
`, { mode: 0o755 });
  return { fake, ran };
}

test("a store that didn't go online says why, in the CLI's words, and where the rest is (XC-085)", async () => {
  const { openStore, useRuntime } = require("../src/state.cjs");
  const yes = async (/** @type {OwnerQuestion[]} */ questions) => ({ [questions[0].question]: "Put it online" });
  for (const [failing, why] of [
    ["lore: Cloudflare needs you to verify your email first. Check your inbox for their email, click the link, then tap Set it up again.", "The deploy did not finish: Cloudflare needs you to verify your email first. Check your inbox for their email, click the link, then tap Set it up again."],
    ["lore: deploy failed:\n✘ [ERROR] Something Cloudflare never said before", "The deploy did not finish: deploy failed: ✘ [ERROR] Something Cloudflare never said before."]
  ]) {
    const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
    try {
      const { fake } = await failingCli(directory, failing);
      useRuntime(fake);
      const said = (await openStore(directory, { inboxOnly: true }, yes, confirming(directory, true, []))).split("\n");
      assert.equal(said[0], why);
      assert.equal(said.at(-1), `Everything Cloudflare said is in ${join(directory, "logs", "store.log")}.`);
    } finally {
      useRuntime(CLI);
      await rm(directory, { recursive: true });
    }
  }
});

test("a Cloudflare sign-in with two accounts asks which one, then puts the store there (XC-087)", async () => {
  const { openStore, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const { fake, ran } = await failingCli(directory, "lore: Your Cloudflare sign-in has more than one account. Choose the one your store goes on (`lore node accounts`), then set it up again.");
  /** @type {OwnerQuestion[][]} */
  const asked = [];
  const answer = (/** @type {string} */ label) => async (/** @type {OwnerQuestion[]} */ questions) => {
    asked.push(questions);
    return { [questions[0].question]: questions[0].question.startsWith("Which") ? label : "Put it online" };
  };
  try {
    useRuntime(fake);
    assert.match(await openStore(directory, { inboxOnly: true }, answer("Lab"), confirming(directory, true, [])), /^The store is deployed/);
    const picker = asked.at(-1)?.[0];
    assert.equal(picker?.question, "Which Cloudflare account should your store go on?");
    assert.deepEqual(picker?.options.map((option) => option.label), ["Ada's Account", "Lab"]);
    assert.equal(await readFile(ran, "utf8"), `node deploy --inbox-only\nnode deploy --inbox-only --account ${"f".repeat(32)}\n`);
    assert.match(await openStore(directory, { inboxOnly: true }, answer(""), confirming(directory, true, [])), /didn't choose a Cloudflare account/);
  } finally {
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

test("Update store puts out the newer store Lore ships, on its card, as the store was last opened; a decision's push never does (APP-231)", async () => {
  const { useRuntime } = require("../src/state.cjs");
  const wallet = `0x${"ab12".repeat(9)}c0de`;
  const latest = { group: "", label: "Store", to: "The latest from Lore" };
  /** @param {Parameters<typeof recordingCli>[2]} store @param {{address: string | null, network: string} | null} payout */
  const outdated = async (store, payout) => {
    const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
    const cli = await recordingCli(directory, null, store);
    useRuntime(cli.fake);
    await recordPayout(payout);
    /** @type {Array<{heading: string, changes: StoreChange[]}>} */
    const seen = [];
    const ran = async () => (existsSync(cli.ran) ? await readFile(cli.ran, "utf8") : "");
    return { directory, seen, ran, outgoing: (/** @type {boolean} */ yes) => confirming(directory, yes, seen) };
  };
  const made = [];
  try {
    // A store for sale, on real money to an address: a decision's push puts out only what it decided.
    const sale = await outdated({ selling: true, store: "outdated" }, { address: wallet, network: "real" });
    made.push(sale.directory);
    assert.equal(await sale.outgoing(true).push(), true);
    assert.equal(await sale.ran(), "push unattended= stdin=\n");
    assert.equal(sale.seen.length, 0, "nothing to ask: nothing it decided needs a yes");
    // The owner's Update store asks first, naming the newer store, and nothing goes out on a no.
    await rm(join(sale.directory, "ran"));
    assert.equal(await sale.outgoing(false).push({ latest: true }), false);
    assert.deepEqual(sale.seen, [{ heading: "Update your store", changes: [latest] }]);
    assert.equal(await sale.ran(), "", "a cancelled update puts nothing out");
    assert.equal(await sale.outgoing(true).push({ latest: true }), true);
    assert.equal(await sale.ran(), `node deploy --network real --wallet ${wallet} unattended=1 stdin=\n`);
    // One that sells by card alone goes out on its network, with no address.
    const cards = await outdated({ selling: true, store: "outdated" }, { address: null, network: "real" });
    made.push(cards.directory);
    assert.equal(await cards.outgoing(true).push({ latest: true }), true);
    assert.equal(await cards.ran(), "node deploy --network real unattended=1 stdin=\n");
    // One online only for its agents goes out the same way it was put online.
    const agents = await outdated({ selling: false, store: "outdated" }, null);
    made.push(agents.directory);
    assert.equal(await agents.outgoing(true).push({ latest: true }), true);
    assert.equal(await agents.ran(), "node deploy --inbox-only unattended=1 stdin=\n");
    assert.deepEqual(agents.seen, [{ heading: "Update your store", changes: [latest] }]);
    // Already the store this Lore ships, or one this Mac has no record of putting online: nothing to put out.
    for (const store of /** @type {const} */ (["current", "unknown"])) {
      const quiet = await outdated({ selling: false, store }, null);
      made.push(quiet.directory);
      assert.equal(await quiet.outgoing(true).push({ latest: true }), false, store);
      assert.equal(await quiet.ran(), "", store);
      assert.equal(quiet.seen.length, 0, store);
    }
  } finally {
    useRuntime(CLI);
    await recordPayout(null);
    for (const directory of made) await rm(directory, { recursive: true });
  }
});

test("a store that sells puts a waiting piece out only once the owner confirms it, even going online for its agents", async () => {
  const { openStore, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const { fake, ran } = await recordingCli(directory, null, { selling: true, items: [{ id: 2, title: "Hire management first", state: "approved", live: false }] });
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  const ask = async () => { throw new Error("the plain card is not for a store with changes waiting"); };
  try {
    useRuntime(fake);
    assert.match(await openStore(directory, { inboxOnly: true }, ask, confirming(directory, false, seen)), /chose not to/);
    assert.ok(!existsSync(ran));
    assert.deepEqual(seen, [{ heading: "Update your store", changes: [{ group: "Going on sale", label: "Hire management first" }] }]);
    const outgoing = confirming(directory, false, seen);
    assert.equal(await outgoing.push(), false);
    assert.ok(!existsSync(ran), "a cancelled update pushes nothing");
    const yes = confirming(directory, true, seen);
    assert.equal(await yes.push(), true);
    assert.equal(await readFile(ran, "utf8"), "push unattended= stdin=\n");
  } finally {
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

test("a store update lists each piece and term it changes, and only taking pieces down goes out unasked", () => {
  const { storeChanges } = require("../src/state.cjs");
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
  const { openStore, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  // The snapshot (from lore.db, which the agent can write) names a different address.
  const forged = `0x${"bad0".repeat(10)}`;
  const { fake, ran } = await recordingCli(directory, forged, { selling: true });
  const recorded = `0x${"5e11".repeat(9)}f00d`;
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  try {
    useRuntime(fake);
    await recordPayout({ address: recorded, network: "test" });
    const said = await openStore(directory, {}, async () => ({}), confirming(directory, false, seen));
    assert.match(said, /deployed/);
    assert.equal(seen.length, 0, "a redeploy that changes nothing goes ahead without a card");
    assert.equal(await readFile(ran, "utf8"), `node deploy --network test --wallet ${recorded} unattended=1 stdin=\n`);
  } finally {
    await recordPayout(null);
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

test("a new address where the store already pays somewhere is shown as a change, naming both", async () => {
  const { openStore, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const { fake, ran } = await recordingCli(directory, null, { selling: true });
  const recorded = `0x${"5e11".repeat(9)}f00d`;
  const next = `0x${"7777".repeat(10)}`;
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  try {
    useRuntime(fake);
    await recordPayout({ address: recorded, network: "real" });
    assert.match(await openStore(directory, { wallet: next }, async () => ({}), confirming(directory, false, seen)), /chose not to/);
    assert.ok(!existsSync(ran));
    assert.match(await openStore(directory, { wallet: next }, async () => ({}), confirming(directory, true, seen)), /deployed/);
    assert.deepEqual(seen[0], { heading: "Change where your sales are paid", changes: [{ group: "", label: "Paid to", from: `0x ${"5e11 ".repeat(9)}f00d`, to: `0x ${"7777 ".repeat(9)}7777` }] });
    // The same address, in any case, is no change.
    assert.match(await openStore(directory, { wallet: recorded.toUpperCase().replace("0X", "0x") }, async () => ({}), confirming(directory, false, seen)), /deployed/);
    assert.equal(seen.length, 2);
    assert.equal(await readFile(ran, "utf8"), `node deploy --network real --wallet ${next} unattended=1 stdin=\nnode deploy --network real --wallet ${recorded.toUpperCase().replace("0X", "0x")} unattended=1 stdin=\n`);
  } finally {
    await recordPayout(null);
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

test("a store left half-changed is said plainly in the desktop result, with no setting names", async () => {
  const { openStore, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const fake = join(directory, "lore");
  const state = JSON.stringify({ version: 1, publications: { counts: { active: 0, revoked: 0 }, items: [] }, pricing: { publication_usd: 1.5, answer_usd: null, answer_enabled: false, free_copies: 0 }, node: { url: "https://lore.example.workers.dev/mcp", selling: true, live: { state: "online", network: null, price_usd: 1.5, payout: null } } });
  const next = `0x${"7777".repeat(10)}`;
  // The CLI as it ends when the wallet changed, the network did not, and the old wallet could not go back.
  await writeFile(fake, `#!/bin/sh\nif [ "$1" = desktop-state ]; then echo '${state}'; exit 0; fi\necho "! Your store may be half-updated: it now pays ${next} on its old network. Open your store again to finish." >&2\necho "lore: Lore couldn't switch your store's network:" >&2\necho "vault down" >&2\nexit 1\n`, { mode: 0o755 });
  try {
    useRuntime(fake);
    await recordPayout({ address: `0x${"5e11".repeat(10)}`, network: "test" });
    const said = await openStore(directory, { network: "real", wallet: next }, async () => ({}), confirming(directory, true, []));
    // XC-085: the why on the line after the CLI's own is kept, not dropped.
    assert.equal(said, `The deploy did not finish: Lore couldn't switch your store's network: vault down.\nYour store may be half-updated: it now pays ${next} on its old network. Open your store again to finish.\nEverything Cloudflare said is in ${join(directory, "logs", "store.log")}.`);
    assert.ok(!said.includes("LORE_"));
  } finally {
    await recordPayout(null);
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

test("a redeploy with no payout on record asks the owner on the app's own card, never guesses", async () => {
  const { openStore, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const { fake, ran } = await recordingCli(directory, `0x${"bad0".repeat(10)}`);
  const typed = `0x${"7777".repeat(10)}`;
  /** @type {OwnerQuestion[][]} */
  const asked = [];
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  try {
    useRuntime(fake);
    await recordPayout(null);
    // Nothing typed: nothing opens.
    assert.match(await openStore(directory, { network: "real" }, async (questions) => { asked.push(questions); return {}; }, confirming(directory, true, seen)), /no payout address/);
    assert.equal(asked[0][0].format, "evm_address");
    assert.ok(!existsSync(ran));
    const said = await openStore(directory, { network: "real" }, async (questions) => {
      asked.push(questions);
      return { [questions[0].question]: typed };
    }, confirming(directory, true, seen));
    assert.match(said, /deployed/);
    assert.deepEqual(seen.at(-1)?.changes.find((change) => change.label === "Paid to"), { group: "", label: "Paid to", to: `0x ${"7777 ".repeat(9)}7777` });
    assert.equal(await readFile(ran, "utf8"), `node deploy --network real --wallet ${typed} unattended=1 stdin=\n`);
    // And with neither a network asked nor one on record, it says so instead of picking.
    assert.match(await openStore(directory, {}, async () => ({}), confirming(directory, true, seen)), /Say which network/);
  } finally {
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

test("with card payments on, a store opens selling by card alone: no address asked, none deployed", async () => {
  const { openStore, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const { fake, ran } = await recordingCli(directory, null, { cards: "acct_1Seller", items: [{ id: 1, title: "Price the first tier low", state: "approved", live: false }] });
  /** @type {OwnerQuestion[][]} */
  const asked = [];
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  try {
    useRuntime(fake);
    await recordPayout(null);
    const said = await openStore(directory, {}, async (questions) => { asked.push(questions); return {}; }, confirming(directory, true, seen));
    assert.match(said, /deployed/);
    assert.deepEqual(asked, [], "no network and no address asked");
    assert.deepEqual(seen[0].changes.filter((change) => change.group === ""), [
      { group: "", label: "Price", to: "$1.50 a piece" },
      { group: "", label: "Free copies", to: "The first 3 of each piece" },
      { group: "", label: "Payments", to: "By card" },
      { group: "", label: "Paid to", to: "Your bank, through Stripe" }
    ]);
    assert.equal(await readFile(ran, "utf8"), "node deploy --network real unattended=1 stdin=\n");
  } finally {
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

test("on the payout card, By card opens the store only once card payments are really on", async () => {
  const { openStore, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  /** @type {Array<{heading: string, changes: StoreChange[]}>} */
  const seen = [];
  /** @param {OwnerQuestion[]} questions */
  const byCard = async (questions) => ({ [questions[0].question]: "By card" });
  try {
    const off = await recordingCli(directory, null);
    useRuntime(off.fake);
    await recordPayout(null);
    assert.match(await openStore(directory, { network: "real" }, byCard, confirming(directory, true, seen)), /Card payments aren't on yet/);
    assert.ok(!existsSync(off.ran));
  } finally {
    useRuntime(CLI);
    await rm(directory, { recursive: true });
  }
});

test("the profile saves only after the owner sees every part of it in full", async () => {
  const { saveProfile, useRuntime } = require("../src/state.cjs");
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  const { fake, ran } = await recordingCli(directory, null);
  const long = "Keep out ".repeat(60).trim();
  const profile = { role: "Founder", boundaries: long, cadence: "weekly", day: 6, hour: 21, executor: "lore" };
  /** @type {OwnerQuestion[]} */
  const asked = [];
  const answer = (/** @type {string} */ label) => async (/** @type {OwnerQuestion[]} */ questions) => { asked.push(questions[0]); return { [questions[0].question]: label }; };
  try {
    useRuntime(fake);
    assert.match(await saveProfile(directory, profile, answer("Not now")), /chose not to/);
    assert.ok(!existsSync(ran));
    assert.equal(asked[0].question, "Save this profile?");
    assert.equal(asked[0].detail, `Lore reads your apps every Sunday at 9 PM.\n\nRole: Founder\n\nKeep out: ${long}`);
    await saveProfile(directory, profile, answer("Save it"));
    assert.equal(await readFile(ran, "utf8"), `profile - unattended= stdin=${JSON.stringify(profile)}\n`);
  } finally {
    useRuntime(CLI);
    await rm(directory, { recursive: true });
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
    useRuntime(CLI);
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

test("memory delete validates the id before any CLI call, and removes the memory through the CLI", async () => {
  const { deleteMemory, readMemory, lore } = require("../src/state.cjs");
  for (const bad of [0, -1, 1.5, "1", null]) await assert.rejects(deleteMemory("/nonexistent", bad), { message: /Invalid memory/ });
  const directory = await mkdtemp(join(tmpdir(), "lore-desktop-"));
  try {
    await assert.rejects(deleteMemory(directory, 999), { message: /memory not found: 999/ });
    const [{ id }] = JSON.parse(await lore(directory, ["capture", "apply", "-"], JSON.stringify([{ title: "Stale", content: "Wrong about this." }])));
    assert.deepEqual(await deleteMemory(directory, id), { deleted: id });
    await assert.rejects(readMemory(directory, id), { message: new RegExp(`memory not found: ${id}`) });
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
    // With no model named, Lore reads on the saved rhythm itself (AUT-009).
    assert.equal((await readState(home)).setup.schedule?.hour, 21);
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
