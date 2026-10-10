const { execFile, spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { promisify } = require("node:util");
const { randomBytes } = require("node:crypto");
const { mkdirSync, writeFileSync } = require("node:fs");
const { homedir } = require("node:os");
const { dirname, join, resolve } = require("node:path");

const run = promisify(execFile);
const root = resolve(__dirname, "../../..");

/** The packaged CLI runs from the Lore home: the app inherits whatever directory launched it, and the CLI treats a checkout there as development. @type {{file: string, args: string[], cwd?: string}} */
let runtime = { file: "uv", args: ["run", "lore"], cwd: root };

/** Where the CLI checks a decision came from this app: outside every root the agent's sandbox can read. */
const ATTENDED_KEY = join(homedir(), "Library", "Application Support", "Lore", "attended");
/** Fresh each launch and never in process.env, so the agent's shell cannot pass it. */
const attendedKey = randomBytes(32).toString("hex");

/** Rewritten on every decision, so the app that launched last still answers for itself. */
function attended() {
  mkdirSync(dirname(ATTENDED_KEY), { recursive: true });
  writeFileSync(ATTENDED_KEY, attendedKey, { mode: 0o600 });
  return { LORE_ATTENDED_KEY: attendedKey };
}

/** @param {string} [file] */
function useRuntime(file) {
  runtime = file ? { file, args: [] } : { file: "uv", args: ["run", "lore"], cwd: root };
}

/** @param {string} loreHome @param {string[]} args @param {string} [decision] @param {AbortSignal} [signal] */
async function lore(loreHome, args, decision, signal) {
  const env = { ...process.env, LORE_HOME: loreHome, NO_COLOR: "1", ...(decision === undefined ? {} : attended()) };
  const pending = run(runtime.file, [...runtime.args, ...args], {
    cwd: runtime.cwd ?? loreHome,
    env,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 120_000,
    windowsHide: true,
    signal
  });
  pending.child.stdin?.end(decision);
  try {
    return (await pending).stdout;
  } catch (error) {
    if (signal?.aborted) throw new Error("Cancelled");
    const stderr = String(/** @type {{stderr?: string}} */ (error).stderr ?? "").trim();
    // The log keeps all of it, so a failure that ends in a brace or a blank still says what happened somewhere.
    console.error(`lore ${args.join(" ")} failed:\n${stderr || /** @type {Error} */ (error).message}`);
    // A refusal the CLI explains over several lines carries its cause on a "Reason:" line; otherwise the owner sees the last line.
    const lines = stderr.split("\n").map((line) => line.trim());
    const said = lines.find((line) => line.startsWith("Reason: "))?.slice(8) ?? lines.at(-1) ?? "";
    throw new Error(said.replace(/^lore: /, "") || "Lore could not finish that");
  }
}

/** @param {string} file @param {string[]} args @param {Record<string, string>} env @param {(line: string) => void} onLine @param {string} [cwd] @param {AbortSignal} [signal] */
function stream(file, args, env, onLine, cwd, signal) {
  return new Promise((done, fail) => {
    const child = spawn(file, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, signal });
    for (const output of [child.stdout, child.stderr]) {
      if (output) createInterface({ input: output }).on("line", (line) => line.trim() && onLine(line.trim()));
    }
    child.on("error", fail);
    child.on("close", (code) => (code === 0 ? done(undefined) : fail(new Error(`${file} exited with ${code}`))));
  });
}

/** Run the CLI and hand back each output line as it arrives, for commands that wait on the owner. @param {string} loreHome @param {string[]} args @param {(line: string) => void} onLine @param {AbortSignal} [signal] */
function loreStream(loreHome, args, onLine, signal) {
  return stream(runtime.file, [...runtime.args, ...args], { LORE_HOME: loreHome, NO_COLOR: "1" }, onLine, runtime.cwd ?? loreHome, signal);
}

/** The hosts the payments skill sends an owner to; anything else stays closed. */
const OPENABLE = new Set(["coinbase.com", "www.coinbase.com", "dash.cloudflare.com", "basescan.org", "sepolia.basescan.org"]);

/** Where Granola, Notion and Readwise ask the owner to approve Lore. */
const SIGN_IN = new Set(["mcp-auth.granola.ai", "mcp.notion.com", "readwise.io"]);

/** @param {string} url @param {Set<string>} [hosts] */
function openable(url, hosts = OPENABLE) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === "https:" && hosts.has(hostname);
  } catch {
    return false;
  }
}

/** @param {string} loreHome */
async function readState(loreHome) {
  const value = JSON.parse(await lore(loreHome, ["desktop-state"]));
  if (!value || typeof value !== "object" || value.version !== 1) {
    throw new Error("Lore returned an unsupported desktop state");
  }
  return /** @type {Snapshot} */ (value);
}

/** @param {string} loreHome @returns {Promise<Sale[]>} */
async function readSales(loreHome) {
  return JSON.parse(await lore(loreHome, ["node", "sales", "--json"]));
}

/** How often each piece's page was opened, keyed by its public id. @param {string} loreHome @returns {Promise<Record<string, number>>} */
async function readViews(loreHome) {
  /** @type {Array<{item_id: string, views: number}>} */
  const rows = JSON.parse(await lore(loreHome, ["node", "views", "--json"]));
  return Object.fromEntries(rows.map((row) => [row.item_id, row.views]));
}

/** @param {string} loreHome @param {string} query @returns {Promise<SearchHit[]>} */
async function searchMemories(loreHome, query) {
  const terms = query.trim().split(/\s+/).filter((term) => term && !term.startsWith("-")).slice(0, 8);
  if (!terms.length) return [];
  return JSON.parse(await lore(loreHome, ["search", ...terms, "--status", "private", "--limit", "30", "--json"]));
}

/** @param {string} loreHome @param {unknown} id @returns {Promise<Memory>} */
async function readMemory(loreHome, id) {
  if (!Number.isInteger(id) || /** @type {number} */ (id) < 1) throw new Error("Invalid memory");
  return JSON.parse(await lore(loreHome, ["memory", "show", String(id), "--json"]));
}

/** @param {string} loreHome @param {unknown} id @param {string} title @returns {Promise<Memory>} */
async function renameMemory(loreHome, id, title) {
  if (!Number.isInteger(id) || /** @type {number} */ (id) < 1) throw new Error("Invalid memory");
  const trimmed = title.trim();
  if (!trimmed) throw new Error("Title cannot be empty");
  return JSON.parse(await lore(loreHome, ["memory", "rename", String(id), trimmed, "--json"]));
}

/** @param {string} loreHome @param {unknown} id @param {string} content @returns {Promise<Memory>} */
async function editMemory(loreHome, id, content) {
  if (!Number.isInteger(id) || /** @type {number} */ (id) < 1) throw new Error("Invalid memory");
  const trimmed = content.trim();
  if (!trimmed) throw new Error("Content cannot be empty");
  // Over stdin, not argv: content that starts with a dash is not an option.
  return JSON.parse(await lore(loreHome, ["memory", "edit", String(id), "--stdin", "--json"], trimmed));
}

/** Save the memories exactly as the owner kept them on the card. @param {string} loreHome @param {ProposedMemory[]} entries @returns {Promise<SavedMemory[]>} */
async function captureMemories(loreHome, entries) {
  if (!entries.length) return [];
  return JSON.parse(await lore(loreHome, ["capture", "apply", "-"], JSON.stringify(entries)));
}

/** A draft's piece page exactly as the store would render it, before anything is published.
 * @param {PublicationCandidate} candidate @param {{priceUsd: number, origin: string, test: boolean}} store */
async function previewPage(candidate, store) {
  const { publicationPage } = await import("./storefront.mjs");
  const piece = {
    id: "0".repeat(24),
    teaser: candidate.teaser,
    kind: candidate.kind,
    topic: candidate.topic,
    section: 0,
    updated_at: new Date().toISOString().slice(0, 10),
    sample: candidate.sample,
    useful_if: candidate.useful_if,
    not_useful_if: candidate.not_useful_if
  };
  return publicationPage(piece, { name: "", priceUsd: store.priceUsd, origin: store.origin, test: Boolean(store.test) });
}

/** The one global publication price, saved through Lore's own validation.
 * Zero is a legal CLI value ("free"), but a store the owner is pricing needs a
 * positive one — choosing not to sell stays a conversation, not a text field.
 * @param {string} loreHome @param {unknown} amount */
async function setPrice(loreHome, amount) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    throw new Error("A price has to be a number above zero");
  }
  // Attended, like revoke: the owner typed this amount on a card in the app.
  await lore(loreHome, ["price", String(amount)], "");
}

/** How many copies of each piece are given away before it costs anything; zero gives none away.
 * @param {string} loreHome @param {unknown} count */
async function setFreeCopies(loreHome, count) {
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
    throw new Error("Free copies has to be a whole number, zero or more");
  }
  await lore(loreHome, ["free-copies", String(count)], "");
}

/** @param {unknown} id */
function collectionId(id) {
  if (!Number.isInteger(id) || /** @type {number} */ (id) < 1) throw new Error("Invalid collection");
  return String(id);
}

/** A collection exists the moment it's asked for; naming it can wait. Attended: it's the owner's click.
 * @param {string} loreHome @param {string} [title] @returns {Promise<NewCollection>} */
async function newCollection(loreHome, title) {
  const named = typeof title === "string" ? title.trim() : "";
  return JSON.parse(await lore(loreHome, ["collection", "new", ...(named ? ["--title", named] : [])], ""));
}

/** Pasted text and dropped files, checked and trimmed before they reach the CLI.
 * @param {{items?: Array<{title: string, content: string}>, files?: string[]}} input */
function pieceInput(input) {
  const items = (input.items ?? []).map((item) => ({ title: String(item.title ?? "").trim(), content: String(item.content ?? "").trim() }));
  const files = (input.files ?? []).filter((path) => typeof path === "string" && path.startsWith("/"));
  if (items.some((item) => !item.content)) throw new Error("There's nothing to add in that text");
  if (!items.length && !files.length) throw new Error("Drop a file or paste some text first");
  return { items, files };
}

/** Pasted text and dropped files, each kept as one piece of the collection. Over stdin, never argv.
 * @param {string} loreHome @param {unknown} id @param {{items?: Array<{title: string, content: string}>, files?: string[]}} input
 * @returns {Promise<{added: Array<{publication_id: number, public_id: string, title: string}>}>} */
async function addToCollection(loreHome, id, input) {
  const which = collectionId(id);
  return JSON.parse(await lore(loreHome, ["collection", "add", which, "-"], JSON.stringify(pieceInput(input))));
}

/** Pasted text and dropped files, each put on sale as its own piece. Attended: the owner's click. Over stdin, never argv.
 * @param {string} loreHome @param {{items?: Array<{title: string, content: string}>, files?: string[]}} input
 * @returns {Promise<{added: Array<{publication_id: number, public_id: string, title: string}>}>} */
async function sellPieces(loreHome, input) {
  return JSON.parse(await lore(loreHome, ["sell", "-"], JSON.stringify(pieceInput(input))));
}

/** @param {string} loreHome @param {unknown} id @param {string} title */
async function renameCollection(loreHome, id, title) {
  const which = collectionId(id);
  const trimmed = title.trim();
  if (!trimmed) throw new Error("A collection needs a name");
  await lore(loreHome, ["collection", "rename", which, "--", trimmed], "");
}

/** Zero takes it off sale; anything above puts it on sale at that price.
 * @param {string} loreHome @param {unknown} id @param {unknown} amount */
async function priceCollection(loreHome, id, amount) {
  const which = collectionId(id);
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) throw new Error("A price has to be a number, zero or more");
  await lore(loreHome, ["collection", "price", which, String(amount)], "");
}

/** Takes one piece out of the collection and off sale. @param {string} loreHome @param {unknown} id @param {unknown} piece */
async function removeFromCollection(loreHome, id, piece) {
  const which = collectionId(id);
  if (!Number.isInteger(piece) || /** @type {number} */ (piece) < 1) throw new Error("Invalid piece");
  await lore(loreHome, ["collection", "remove", which, String(piece)], "");
}

/** @param {string} loreHome @param {unknown} id */
async function deleteCollection(loreHome, id) {
  await lore(loreHome, ["collection", "delete", collectionId(id)], "");
}

/** Turn the feed on, at a price or at Lore's suggestion when none is given. @param {string} loreHome @param {unknown} amount */
async function setFeed(loreHome, amount) {
  if (amount !== null && (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0)) throw new Error("A price has to be a number above zero");
  return JSON.parse(await lore(loreHome, ["feed", "on", ...(amount === null ? [] : ["--price", String(amount)])], ""));
}

/** @param {string} loreHome */
async function feedOff(loreHome) {
  await lore(loreHome, ["feed", "off"], "");
}

/** @param {string} loreHome @returns {Promise<PublicationCandidate[]>} */
async function candidates(loreHome) {
  return JSON.parse(await lore(loreHome, ["publication", "candidates"]));
}

/** @param {string} loreHome @param {PublicationCandidate} original @param {PublicationCandidate} candidate @param {boolean} approve */
async function decide(loreHome, original, candidate, approve) {
  await lore(loreHome, ["publication", "decide"], JSON.stringify({ original, candidate, approve }));
}

/** @param {string} loreHome @returns {Promise<ExtrasCandidate[]>} */
async function extrasCandidates(loreHome) {
  return JSON.parse(await lore(loreHome, ["publication", "extras", "candidates"]));
}

/** @param {string} loreHome @param {PublicationExtras} original @param {PublicationExtras} extras @param {boolean} approve */
async function decideExtras(loreHome, original, extras, approve) {
  await lore(loreHome, ["publication", "extras", "decide"], JSON.stringify({ original, extras, approve }));
}

/** Approve a batch of free-parts cards in one CLI call, so the store is pushed once.
 * @param {string} loreHome @param {Array<{original: PublicationExtras, extras: PublicationExtras}>} decisions */
async function approveExtras(loreHome, decisions) {
  await lore(loreHome, ["publication", "extras", "decide"], JSON.stringify(decisions.map(({ original, extras }) => ({ original, extras, approve: true }))));
}

/** Send one feedback report through `lore report-feedback`. The description
 * goes over stdin (`editMemory` does the same, for the same reason: owner
 * text that starts with a dash must never be read as an option). Title and
 * email go as `--flag=value`, not `--flag value` — argparse otherwise
 * refuses a value that looks like an unrecognized option, e.g. a title of
 * literally `--json`, which the owner is free to type.
 * @param {string} loreHome @param {{title: string, email: string, description: string}} input
 * @returns {Promise<{url: string, number: number}>} */
async function reportFeedback(loreHome, input) {
  const title = input.title.trim();
  if (!title) throw new Error("Title cannot be empty");
  const description = input.description.trim();
  if (!description) throw new Error("Description cannot be empty");
  const email = input.email.trim();
  const args = ["report-feedback", `--title=${title}`, "--description-file", "-", "--json"];
  if (email) args.push(`--email=${email}`);
  return JSON.parse(await lore(loreHome, args, description));
}

/** Switch this store on or off for the public marketplace through `lore marketplace`; listing hands back the request form to open.
 * @param {string} loreHome @param {"list" | "delist"} action
 * @returns {Promise<Listing>} */
async function listStore(loreHome, action) {
  if (action !== "list" && action !== "delist") throw new Error("Invalid listing action");
  return JSON.parse(await lore(loreHome, ["marketplace", action, "--json"], ""));
}

/** Card payments: the account taking them, one Stripe hasn't cleared yet, and whether it has. @param {string} loreHome @returns {Promise<CardStatus>} */
async function cardStatus(loreHome) {
  return JSON.parse(await lore(loreHome, ["cards", "--json"]));
}

/** Open (or reopen) the owner's own Stripe account through Lore's checkout; returns Stripe's form to finish in the browser. @param {string} loreHome @returns {Promise<{account: string, url: string}>} */
async function connectCards(loreHome) {
  return JSON.parse(await lore(loreHome, ["cards", "connect", "--json"], ""));
}

/** Turn card payments on into an account Stripe cleared, or off. @param {string} loreHome @param {string | null} account */
async function switchCards(loreHome, account) {
  if (account !== null && !/^acct_[A-Za-z0-9]+$/.test(account)) throw new Error("Invalid Stripe account");
  await lore(loreHome, account === null ? ["cards", "off"] : ["cards", "account", account], "");
}

/** Whether this store is listed, pending, or neither, read from the public list. @param {string} loreHome @returns {Promise<Listing>} */
async function listingStatus(loreHome) {
  return JSON.parse(await lore(loreHome, ["marketplace", "status", "--json"]));
}

/** An app id as the catalog spells it; the CLI is the one that knows the catalog. @param {unknown} app */
function connector(app) {
  if (typeof app !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(app)) throw new Error("Unknown app");
  return app;
}

/** @param {unknown} name */
function sourceName(name) {
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("Unknown source");
  return name;
}

/** What an app offers to connect, found by the CLI without asking the owner. @param {string} loreHome @param {unknown} app @returns {Promise<SourceChoice[]>} */
async function sourceChoices(loreHome, app) {
  return JSON.parse(await lore(loreHome, ["sources", "choices", connector(app), "--json"]));
}

/** The apps Lore can connect, as the CLI's catalog describes them. @param {string} loreHome @returns {Promise<SourceApp[]>} */
async function sourceCatalog(loreHome) {
  return JSON.parse(await lore(loreHome, ["sources", "catalog", "--json"]));
}

/** Connect one place an app keeps, read it once, and hand back its row. With `replace`, the CLI reads
 * the new place before it retires the old one. The locator follows `--` so a path that starts with a
 * dash stays a value. @param {string} loreHome @param {{connector?: unknown, locator?: unknown, replace?: unknown}} input @param {AbortSignal} [signal]
 * @returns {Promise<SourceEntry>} */
async function connectSource(loreHome, input, signal) {
  const app = connector(input?.connector);
  if (typeof input.locator !== "string" || !input.locator.trim()) throw new Error("Choose what to connect");
  const replacing = input.replace === undefined ? [] : [`--replace=${sourceName(input.replace)}`];
  return JSON.parse(await lore(loreHome, ["sources", "connect", app, ...replacing, "--json", "--", input.locator], undefined, signal));
}

/** Sign in to an app that runs its own server, then read it. The CLI names the approval page and
 * waits for the owner there; `open` shows it to them. Signing in again reads the app again. @param {string} loreHome @param {unknown} app @param {(url: string) => void} open
 * @param {AbortSignal} signal @returns {Promise<SourceEntry>} */
async function signIn(loreHome, app, open, signal) {
  let last = "";
  let result = "";
  try {
    await loreStream(loreHome, ["sources", "connect", connector(app), "--json"], (line) => {
      // stderr interleaves with stdout, so the result is the JSON line, not the last one.
      if (line.startsWith("{")) result = line;
      else last = line;
      const url = line.match(/^Approve Lore in your browser: (\S+)$/)?.[1];
      if (url && openable(url, SIGN_IN)) open(url);
    }, signal);
  } catch (error) {
    if (signal.aborted) throw new Error("Signing in was cancelled");
    throw new Error(last.replace(/^lore: /, "") || /** @type {Error} */ (error).message);
  }
  return JSON.parse(result);
}

/** @param {string} loreHome @param {unknown} name @returns {Promise<SourceRead[]>} */
async function readSource(loreHome, name) {
  return JSON.parse(await lore(loreHome, ["sources", "read", sourceName(name), "--json"]));
}

/** @param {string} loreHome @param {unknown} name @param {boolean} keep @returns {Promise<SourceRemoval>} */
async function removeSource(loreHome, name, keep) {
  return JSON.parse(await lore(loreHome, ["sources", "remove", sourceName(name), keep ? "--keep" : "--delete", "--json"]));
}

module.exports = {
  lore,
  loreStream,
  stream,
  openable,
  readState,
  readSales,
  readViews,
  searchMemories,
  readMemory,
  renameMemory,
  editMemory,
  captureMemories,
  previewPage,
  setPrice,
  setFreeCopies,
  newCollection,
  addToCollection,
  sellPieces,
  renameCollection,
  priceCollection,
  removeFromCollection,
  deleteCollection,
  setFeed,
  feedOff,
  candidates,
  decide,
  extrasCandidates,
  decideExtras,
  approveExtras,
  reportFeedback,
  listStore,
  cardStatus,
  connectCards,
  switchCards,
  listingStatus,
  sourceCatalog,
  sourceChoices,
  connectSource,
  signIn,
  readSource,
  removeSource,
  useRuntime
};
