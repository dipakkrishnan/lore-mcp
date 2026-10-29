const { execFile, spawn } = require("node:child_process");
const { createInterface } = require("node:readline");
const { promisify } = require("node:util");
const { randomBytes } = require("node:crypto");
const { chmodSync, closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, writeSync } = require("node:fs");
const { homedir, userInfo } = require("node:os");
const { dirname, join, resolve } = require("node:path");

const run = promisify(execFile);
const root = resolve(__dirname, "../../..");

/** The packaged CLI runs from the Lore home: the app inherits whatever directory launched it, and the CLI treats a checkout there as development. @type {{file: string, args: string[], cwd?: string}} */
let runtime = { file: "uv", args: ["run", "lore"], cwd: root };

/** Where the CLI checks a decision came from this app: outside every root the agent's sandbox can read, in the account's own home rather than whatever HOME says. */
const ATTENDED_KEYS = join(userInfo().homedir, "Library", "Application Support", "Lore", "attended.d");
/** The store's code and tools, outside Lore's home, as the CLI finds them (lore/paths.py store_folder). */
const STORE = process.env.LORE_STORE || join(homedir(), "Library", "Application Support", "Lore", "store");

/** This launch's key, in a file of its own so every running app and test run keeps its key; the key is fresh each launch and never in process.env, so the agent's shell cannot pass it. */
class LaunchKey {
  /** An empty or unreadable file is cleared after this long; a running app's file never is. */
  static STALE_MS = 7 * 24 * 60 * 60 * 1000;
  /** A key file holds a pid and the key; the CLI reads no more than this either (lore/cli.py KEY_FILE_BYTES). */
  static FILE_BYTES = 256;

  /** @param {string} folder */
  constructor(folder) {
    this.folder = folder;
    this.key = randomBytes(32).toString("hex");
    /** @type {string | undefined} */
    this.file = undefined;
    this.started = false;
  }

  /** The key for a CLI call. The file is written once and never rewritten; if something removed it, a new one takes its place. @returns {{LORE_ATTENDED_KEY: string}} */
  env() {
    this.trust();
    if (!this.started) {
      this.started = true;
      this.prune();
      process.once("exit", () => this.remove());
    }
    if (!this.file || !lstatSync(this.file, { throwIfNoEntry: false })?.isFile()) this.write();
    return { LORE_ATTENDED_KEY: this.key };
  }

  remove() {
    if (this.file) rmSync(this.file, { force: true });
    this.file = undefined;
  }

  /** The folder must be a real folder of this account's, closed to everyone else. */
  trust() {
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    const folder = lstatSync(this.folder);
    if (!folder.isDirectory() || folder.uid !== process.getuid?.()) throw new Error(`${this.folder} is not a folder Lore can trust`);
    if ((folder.mode & 0o777) !== 0o700) chmodSync(this.folder, 0o700);
  }

  /** Created whole under a name of its own, never the key, and closed to everyone else. */
  write() {
    const file = join(this.folder, randomBytes(16).toString("hex"));
    const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try {
      fchmodSync(fd, 0o600);
      writeSync(fd, `${process.pid}\n${this.key}\n`);
    } finally {
      closeSync(fd);
    }
    this.file = file;
  }

  /** Clear the files of apps that are no longer running, and empty ones left long ago. */
  prune() {
    for (const name of readdirSync(this.folder)) {
      const file = join(this.folder, name);
      const read = LaunchKey.read(file);
      if (!read || file === this.file) continue;
      const pid = Number(read.text.split("\n")[0]);
      const gone = Number.isInteger(pid) && pid > 0 ? !LaunchKey.running(pid) : Date.now() - read.mtimeMs > LaunchKey.STALE_MS;
      if (gone) rmSync(file, { force: true });
    }
  }

  /** The start of one of this account's regular files, opened without following a link or waiting on a pipe. @param {string} file */
  static read(file) {
    let fd;
    try {
      fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    } catch {
      return undefined;
    }
    try {
      const info = fstatSync(fd);
      if (!info.isFile() || info.uid !== process.getuid?.()) return undefined;
      const buffer = Buffer.alloc(LaunchKey.FILE_BYTES);
      const size = readSync(fd, buffer, 0, buffer.length, 0);
      return { text: buffer.toString("utf8", 0, size), mtimeMs: info.mtimeMs };
    } finally {
      closeSync(fd);
    }
  }

  /** @param {number} pid */
  static running(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return /** @type {NodeJS.ErrnoException} */ (error).code === "EPERM";
    }
  }
}

let launchKey = new LaunchKey(ATTENDED_KEYS);

/** Tests keep their launch keys in scratch; the app never calls this. @param {string} folder */
function useKeys(folder) {
  launchKey = new LaunchKey(folder);
}

/** On quit: this launch's key file goes with it. */
function forgetKey() {
  launchKey.remove();
}

/** @param {string} [file] */
function useRuntime(file) {
  runtime = file ? { file, args: [] } : { file: "uv", args: ["run", "lore"], cwd: root };
}

/** @param {string} loreHome @param {string[]} args @param {string} [decision] @param {AbortSignal} [signal] */
async function lore(loreHome, args, decision, signal) {
  // What a decision would put on the store waits for the owner's yes to it (APP-226); the app pushes after.
  const env = { ...process.env, LORE_HOME: loreHome, NO_COLOR: "1", LORE_HOLD_PUSH: "1", ...(decision === undefined ? {} : launchKey.env()) };
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

/** @typedef {(questions: OwnerQuestion[]) => Promise<Record<string, string>>} Ask One owner card; resolves to the answer for each question. */

/** One yes-or-no card, with anything it would save shown in full; true only on the yes. @param {Ask} ask @param {string} header @param {string} question @param {string} yes @param {string} what @param {string} [detail] */
async function confirmed(ask, header, question, yes, what, detail) {
  const answers = await ask([{ question, header, options: [{ label: yes, description: what, recommended: true }, { label: "Not now", description: "Nothing changes" }], multiSelect: false, ...(detail ? { detail } : {}) }]);
  return answers?.[question] === yes;
}

/** A payout address in groups of four, so the owner can check every character. @param {string} address */
const grouped = (address) => `0x ${address.slice(2).match(/.{1,4}/g)?.join(" ")}`;

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

/** What the store's last deploy recorded in the store's own folder, which the agent can't touch. @returns {{address?: unknown, network?: unknown}} */
function recorded() {
  try {
    return JSON.parse(readFileSync(join(STORE, "payout.json"), "utf8")) ?? {};
  } catch {
    return {};
  }
}

/** Where the store pays out and on which network, as its last deploy recorded it; null when there is none. @returns {{address: string, network: "real" | "test" | null} | null} */
function recordedPayout() {
  const { address, network } = recorded();
  if (typeof address !== "string" || !ADDRESS.test(address)) return null;
  return { address, network: network === "real" || network === "test" ? network : null };
}

/** The network a store that sells by card alone last opened on: it has no address on record, only that. @returns {"real" | "test" | null} */
function recordedNetwork() {
  const { network } = recorded();
  return network === "real" || network === "test" ? network : null;
}

/** Whether the owner takes card payments, which is enough for a store to sell without a payout address. @param {string} loreHome */
async function takesCards(loreHome) {
  return Boolean((await cardStatus(loreHome).catch(() => null))?.account);
}

/** What the owner answers on the payout card to sell by card instead of to an address. */
const BY_CARD = "By card";

/** Six decimals, as the renderer shows prices: a price below a cent must not read as $0.00 on a card the owner confirms. */
const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 6 });

const ON_SALE = "Going on sale";
const UPDATED = "Updated";
const COMING_OFF = "Coming off";
/** @param {"real" | "test"} network */
const networkName = (network) => (network === "real" ? "Real money" : "Test network");
/** @param {number | null} usd */
const each = (usd) => (usd === null ? "No price set" : `${dollars.format(usd)} a piece`);

/**
 * APP-226: what a store update puts out, one line each: pieces going on sale, pieces whose free parts changed
 * (`updated`, by publication id), pieces coming off, and a new price. A deploy for sale (`deploy`) also names its
 * network and payout and, opening the store, its free copies and new address. A store that sells nothing puts no
 * piece out when it updates, so it changes nothing here.
 * @param {Snapshot} state @param {Iterable<number>} [updated] @param {SaleDeploy} [deploy] @returns {StoreChange[]}
 */
function storeChanges(state, updated = [], deploy) {
  const opening = Boolean(deploy) && !state.node.selling;
  if (!opening && !state.node.selling) return [];
  const ids = new Set(updated);
  /** @type {StoreChange[]} */
  const changes = [];
  for (const item of state.publications.items) {
    if (item.state === "approved" && (opening || item.live === false)) changes.push({ group: ON_SALE, label: item.title });
    else if (item.state === "approved" && ids.has(item.id)) changes.push({ group: UPDATED, label: item.title });
    else if (item.state === "revoked" && item.live === true) changes.push({ group: COMING_OFF, label: item.title });
  }
  const price = state.pricing.publication_usd;
  const charged = state.node.live.price_usd;
  if (opening) {
    const free = state.pricing.free_copies ?? 0;
    changes.push({ group: "", label: "Price", to: each(price) }, { group: "", label: "Free copies", to: free ? `The first ${free} of each piece` : "None" });
  } else if (typeof charged === "number" && typeof price === "number" && charged !== price) {
    changes.push({ group: "", label: "Price", from: each(charged), to: each(price) });
  }
  if (!deploy) return changes;
  const { network, payout, recorded } = deploy;
  if (payout === null) {
    // By card alone: Stripe pays the owner's bank, and only a store opening says so.
    if (opening) changes.push({ group: "", label: "Payments", to: network === "real" ? "By card" : "By card, with Stripe's test cards" }, { group: "", label: "Paid to", to: "Your bank, through Stripe" });
    if (opening && !state.node.url) changes.push({ group: "", label: "Address", to: "A new one, made as it opens" });
    return changes;
  }
  const switched = !opening && recorded?.network && recorded.network !== network ? recorded.network : null;
  if (opening || switched) changes.push({ group: "", label: "Payments", ...(switched ? { from: networkName(switched) } : {}), to: networkName(network) });
  // A new address where the store already pays somewhere is a change, and the card names both.
  const moved = recorded && recorded.address.toLowerCase() !== payout.toLowerCase() ? grouped(recorded.address) : null;
  if (opening || moved) changes.push({ group: "", label: "Paid to", ...(moved ? { from: moved } : {}), to: grouped(payout) });
  if (opening && !state.node.url) changes.push({ group: "", label: "Address", to: "A new one, made as it opens" });
  return changes;
}

/** APP-231: the newer store this Lore ships, as the owner's card names it. */
const LATEST = { group: "", label: "Store", to: "The latest from Lore" };

/** What an update puts out, and the newer store too when the one online is older than this Lore's: a deploy always
 * puts out the store this Lore ships. @param {Snapshot} state @param {StoreChange[]} changes */
const withLatest = (state, changes) => (state.node.store === "outdated" ? [...changes, LATEST] : changes);

/** Only taking pieces down goes out without the owner's yes. @param {StoreChange[]} changes */
const asks = (changes) => changes.some((change) => change.group !== COMING_OFF);

/** APP-226: store updates wait on the owner's yes to each change they put out. Pieces whose free parts the owner
 * approved go out marked as updated until an update lands. */
class Outgoing {
  /** @param {string} loreHome @param {Confirm} confirm */
  constructor(loreHome, confirm) {
    this.loreHome = loreHome;
    this.confirm = confirm;
    /** @type {Set<number>} */
    this.updated = new Set();
  }

  /** @param {number[]} ids */
  mark(ids) {
    for (const id of ids) this.updated.add(id);
  }

  /** What an update with no deploy terms of its own would put out, as the owner's card lists it. Every caller deploys
   * it, so the newer store goes out with it. */
  async changes() {
    const state = await readState(this.loreHome);
    return withLatest(state, storeChanges(state, this.updated));
  }

  /** Whether the owner said yes to what an update with no terms of its own puts out; one with nothing to confirm goes ahead. */
  async confirmed() {
    const changes = await this.changes();
    return !asks(changes) || (await this.confirm("Update your store", changes));
  }

  /** Push the pieces and price of a store that sells, once the owner says yes to what it puts out; one with nothing
   * to confirm goes ahead. Resolves to whether it went. `latest`, the owner's own optional Update where the store
   * shows, also puts out the newer store this Lore ships (APP-231), as it was last opened: for sale on its network and
   * payout, or for agents only. Every other push leaves the store as it is, so it never asks about more than it says. */
  async push({ latest = false } = {}) {
    const state = await readState(this.loreHome);
    const newer = latest && state.node.store === "outdated";
    if (!state.node.selling && !newer) return false;
    const changes = storeChanges(state, this.updated);
    const out = newer ? [...changes, LATEST] : changes;
    if (asks(out) && !(await this.confirm("Update your store", out))) return false;
    if (newer) {
      const said = await this.deploy(state.node.selling ? redeploy() : ["node", "deploy", "--inbox-only"]);
      if (!said.startsWith("The store is deployed")) throw new Error(said.split("\n").filter((line) => !line.startsWith(STORE_LOG)).join("\n"));
      return true;
    }
    await lore(this.loreHome, ["push"], "");
    this.updated.clear();
    return true;
  }

  /** Run a deploy the owner said yes to, and say how it went. @param {string[]} args */
  async deploy(args) {
    const said = await deployStore(this.loreHome, args);
    if (said.startsWith("The store is deployed")) this.updated.clear();
    return said;
  }
}

/** A store for sale goes out again as its last deploy recorded it: its network, and its payout address when it has
 * one; a store that sells by card alone has only the network. @returns {string[]} */
function redeploy() {
  const payout = recordedPayout();
  const network = payout?.network ?? recordedNetwork();
  return ["node", "deploy", ...(network ? ["--network", network] : []), ...(payout ? ["--wallet", payout.address] : [])];
}

/**
 * Deploy or redeploy the owner's store from the app, outside the agent's sandbox, once the owner says yes on the
 * app's own card to each change it puts out: the pieces, the price, and the network and whole payout address; then
 * say how it went. A redeploy pays out where the store's last deploy recorded, and nothing Lore's home holds; with no
 * record the owner types the address on the app's own card. The deploy always carries the address and network the
 * card showed. It fails fast when Cloudflare is not signed in, so the agent can ask for the sign-in and retry.
 * `inboxOnly` puts the store online for the owner's agents only (XC-069): no network, payout or price, so the card
 * asks only whether to put it online, unless a store already selling would put out changes of its own.
 * @param {string} loreHome @param {OpenStore} store @param {Ask} ask @param {Outgoing} outgoing
 */
async function openStore(loreHome, { network: asked, wallet, inboxOnly }, ask, outgoing) {
  if (inboxOnly) {
    const changes = await outgoing.changes();
    const yes = asks(changes)
      ? await outgoing.confirm("Update your store", changes)
      : await confirmed(ask, "Your store", "Put your store online so your agents can save to it? Nothing goes on sale.", "Put it online", "Takes a few minutes");
    if (!yes) return "The owner chose not to put the store online right now.";
    return deployAsked(loreHome, outgoing, ask, ["node", "deploy", "--inbox-only"]);
  }
  if (asked !== undefined && asked !== "real" && asked !== "test") return "The store opens on real money or the test network; nothing else.";
  if (wallet !== undefined && !ADDRESS.test(wallet)) return "That payout address is not valid; ask the owner for it again.";
  const recorded = recordedPayout();
  /** @type {string | null} */
  let payout = wallet ?? recorded?.address ?? null;
  // With nowhere on record to pay, card payments are enough: the store sells by card alone, on real money unless it
  // last opened on the test network, and the owner is never asked for an address.
  let byCard = !payout && (await takesCards(loreHome));
  const network = asked ?? recorded?.network ?? (byCard ? recordedNetwork() ?? "real" : undefined);
  if (!network) return "Say which network the store opens on: real money or the test network.";
  if (!payout && !byCard) {
    const question = "Where should buyers' payments go?";
    const answer = (await ask([{ question, header: "Payouts", options: [], format: "evm_address", multiSelect: false }]))?.[question]?.trim() ?? "";
    // The card answers By card only once Stripe cleared the owner; the CLI is asked again rather than trusted.
    byCard = answer === BY_CARD && (await takesCards(loreHome));
    if (answer === BY_CARD && !byCard) return "Card payments aren't on yet, so the store did not open.";
    if (!byCard && !ADDRESS.test(answer)) return "The owner gave no payout address, so the store did not open.";
    if (!byCard) payout = answer;
  }
  const state = await readState(loreHome);
  const changes = withLatest(state, storeChanges(state, outgoing.updated, { network, payout, recorded }));
  const moved = payout !== null && recorded && recorded.address.toLowerCase() !== payout.toLowerCase();
  const heading = !state.node.selling ? "Open your store" : moved ? "Change where your sales are paid" : "Update your store";
  if (asks(changes) && !(await outgoing.confirm(heading, changes))) return "The owner chose not to change the store right now.";
  const said = await deployAsked(loreHome, outgoing, ask, ["node", "deploy", "--network", network, ...(payout === null ? [] : ["--wallet", payout])]);
  // Said plainly, so the agent never reads a card-only store's missing payout address as something left undone.
  return byCard && said.startsWith("The store is deployed") ? `${said}\n${BY_CARD_ONLY}` : said;
}

/** XC-087: a Cloudflare sign-in with several accounts asks the owner which one the store goes on, once; the CLI
 * remembers the answer, and the deploy runs again there. @param {string} loreHome @param {Outgoing} outgoing @param {Ask} ask
 * @param {string[]} args */
async function deployAsked(loreHome, outgoing, ask, args) {
  const said = await outgoing.deploy(args);
  if (!said.includes("more than one account")) return said;
  const accounts = /** @type {Array<{id: string, name: string}>} */ (JSON.parse(await lore(loreHome, ["node", "accounts", "--json"])));
  // Two accounts with one name are told apart by the start of their id.
  const label = (/** @type {{id: string, name: string}} */ account) => (accounts.filter((other) => other.name === account.name).length > 1 ? `${account.name} (${account.id.slice(0, 6)})` : account.name);
  const question = "Which Cloudflare account should your store go on?";
  const answer = (await ask([{ question, header: "Cloudflare", options: accounts.map((account) => ({ label: label(account), description: "Your store goes here" })), multiSelect: false }]))?.[question];
  const chosen = accounts.find((account) => label(account) === answer);
  if (!chosen) return "The owner didn't choose a Cloudflare account, so the store did not go online.";
  return outgoing.deploy([...args, "--account", chosen.id]);
}

const BY_CARD_ONLY ="It sells by card: buyers pay on each piece's page, and Stripe pays the owner's bank. There is no payout address to set, and nothing else is left to do.";

/** Where a failed deploy's whole story is, for the agent; the owner hears only why. */
const STORE_LOG = "Everything Cloudflare said is in ";

/** Run one deploy the owner said yes to, and say how it went. @param {string} loreHome @param {string[]} args */
async function deployStore(loreHome, args) {
  const lines = /** @type {string[]} */ ([]);
  try {
    await stream(runtime.file, [...runtime.args, ...args], { LORE_HOME: loreHome, NO_COLOR: "1", LORE_UNATTENDED: "1" }, (line) => lines.push(line), runtime.cwd ?? loreHome);
    // The deploy's own settings lines are plumbing, never what the owner set: leave them out of what the agent reads.
    return `The store is deployed.\n${lines.filter((line) => !/^env\./.test(line.trim())).slice(-8).join("\n")}`;
  } catch {
    // XC-085: the CLI says why on its own last line; one that ends in a colon has the why on the next.
    const at = lines.reduce((found, line, index) => (line.startsWith("lore: ") ? index : found), -1);
    const why = at < 0 ? lines.at(-1) ?? "the deploy stopped" : lines[at].endsWith(":") && lines[at + 1] ? `${lines[at]} ${lines[at + 1]}` : lines[at];
    const said = why.replace(/^lore: /, "").replace(/:$/, "");
    // A change that stopped halfway is said in the CLI's own plain words, so the owner hears it however the deploy ended.
    const half = lines.find((line) => line.startsWith("! Your store may be half-updated"))?.slice(2);
    return [`The deploy did not finish: ${/[.!?]$/.test(said) ? said : `${said}.`}`, ...(half ? [half] : []), `${STORE_LOG}${join(loreHome, "logs", "store.log")}.`].join("\n");
  }
}

/** APP-215: the store online for the owner's agents only, from the first-run chat, where the owner's tap is the yes:
 * nothing goes on sale, so there is no network, payout or price to confirm. Resolves to how it went, as a deploy says.
 * @param {string} loreHome */
function storeOnline(loreHome) {
  return deployStore(loreHome, ["node", "deploy", "--inbox-only"]);
}

/** How long a Cloudflare sign-in waits on the browser before it gives up. */
const SIGN_IN_MS = 5 * 60_000;
const SIGN_IN_UNFINISHED = "Cloudflare sign-in didn't finish. Try again.";

/** Sign in to Cloudflare from the owner's browser; `onUrl` gets the page to open. Resolves to the CLI's last line,
 * and rejects in its own words. It never waits forever: after `wait` it stops the sign-in and says so plainly, and
 * `signal` (the owner's Cancel) stops it at once. `login` is how the sign-in runs, the CLI's unless a walk stands in.
 * @param {string} loreHome @param {(url: string) => void} onUrl
 * @param {{signal?: AbortSignal, wait?: number, login?: (onLine: (line: string) => void, signal: AbortSignal) => Promise<unknown>}} [options] */
async function cloudflareSignIn(loreHome, onUrl, { signal, wait = SIGN_IN_MS, login = (onLine, stop) => loreStream(loreHome, ["node", "login"], onLine, stop) } = {}) {
  const late = AbortSignal.timeout(wait);
  let last = "";
  try {
    await login((line) => {
      last = line;
      const url = line.match(/https:\/\/dash\.cloudflare\.com\/\S+/)?.[0];
      if (url) onUrl(url);
    }, signal ? AbortSignal.any([signal, late]) : late);
  } catch (error) {
    if (signal?.aborted) throw new Error("Cancelled");
    if (late.aborted) throw new Error(SIGN_IN_UNFINISHED);
    throw new Error(last.replace(/^lore: /, "") || /** @type {Error} */ (error).message);
  }
  return last;
}

const atHour = (/** @type {unknown} */ hour) => (typeof hour === "number" ? `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}` : "");
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Save the onboarding profile the agent drafted from the owner's answers, once the owner says yes on a card
 * that says what changes: who reads and when, and each part of the profile; the CLI validates it.
 * @param {string} loreHome @param {Record<string, unknown>} profile @param {Ask} ask
 */
async function saveProfile(loreHome, profile, ask) {
  const when = profile.cadence === "weekly" ? `every ${DAYS[Number(profile.day ?? 0)] ?? "week"}` : profile.cadence === "weekdays" ? "on weekdays" : "every day";
  const parts = /** @type {Array<[string, string]>} */ ([["role", "Role"], ["domains", "Areas"], ["valuable_context", "Worth keeping"], ["preferences", "Preferences"], ["boundaries", "Keep out"]])
    .filter(([field]) => typeof profile[field] === "string" && String(profile[field]).trim())
    .map(([field, label]) => `${label}: ${String(profile[field]).trim()}`);
  // Every value in full: nothing is saved that the owner could not read first.
  const detail = [`Lore reads your apps ${when} at ${atHour(profile.hour)}.`, ...parts].join("\n\n");
  if (!(await confirmed(ask, "Your profile", "Save this profile?", "Save it", "Lore reads on this rhythm while it's open", detail))) return "The owner chose not to save the profile right now.";
  try {
    return (await lore(loreHome, ["profile", "-"], JSON.stringify(profile))).trim();
  } catch (error) {
    return `The profile was not saved: ${/** @type {Error} */ (error).message}`;
  }
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

/** A list of records from the CLI, or a refusal naming it: what it parsed is otherwise handed on unchecked (APP-060).
 * @param {string} output @param {string} what */
function records(output, what) {
  const value = JSON.parse(output);
  if (Array.isArray(value) && value.every((row) => row !== null && typeof row === "object")) return value;
  console.error(`lore returned ${what} that is not a list of records: ${output.slice(0, 200)}`);
  throw new Error(`Lore returned unreadable ${what}`);
}

/** @param {string} loreHome @returns {Promise<Sale[]>} */
async function readSales(loreHome) {
  return records(await lore(loreHome, ["node", "sales", "--json"]), "sales");
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

/** Each kept memory's one-line gist by id, read only where the owner chooses among them; the snapshot carries no memory's words.
 * @param {string} loreHome @returns {Promise<Record<string, string>>} */
async function readGists(loreHome) {
  const value = JSON.parse(await lore(loreHome, ["memory", "gists"]));
  if (!value || typeof value !== "object" || Array.isArray(value) || !Object.values(value).every((gist) => typeof gist === "string")) throw new Error("Lore returned unreadable gists");
  return value;
}

/** How many memories one `lore memory credit` names, as the CLI takes them. */
const CREDIT_AT_ONCE = 500;

/** Put who wrote a reading's memories on record (APP-213), as many at a time as the CLI takes.
 * @param {string} loreHome @param {number[]} ids @param {Contributor} by */
async function creditMemories(loreHome, ids, by) {
  for (let start = 0; start < ids.length; start += CREDIT_AT_ONCE) {
    await lore(loreHome, ["memory", "credit", "-"], JSON.stringify({ ids: ids.slice(start, start + CREDIT_AT_ONCE), by }));
  }
}

/** Keep what a reading judged of each memory it wrote (APP-235), so its sheet offers Draft for sale only where it
 * makes sense. @param {string} loreHome @param {ReadyMemory[]} memories */
async function judgeMemories(loreHome, memories) {
  for (let start = 0; start < memories.length; start += CREDIT_AT_ONCE) {
    const judged = memories.slice(start, start + CREDIT_AT_ONCE).map(({ id, sell, work, why }) => ({ id, sell, work, why }));
    await lore(loreHome, ["memory", "judge", "-"], JSON.stringify({ memories: judged }));
  }
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

/** @param {string} loreHome @param {unknown} id @returns {Promise<{deleted: number}>} */
async function deleteMemory(loreHome, id) {
  if (!Number.isInteger(id) || /** @type {number} */ (id) < 1) throw new Error("Invalid memory");
  return JSON.parse(await lore(loreHome, ["memory", "delete", String(id), "--json"]));
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

/** Pasted text and dropped files, each kept as one piece of the collection. Over stdin, never argv.
 * @param {string} loreHome @param {unknown} id @param {{memories?: number[], items?: Array<{title: string, content: string}>, files?: string[]}} input
 * @returns {Promise<{added: Array<{publication_id: number, public_id: string, title: string}>}>} */
async function addToCollection(loreHome, id, input) {
  const which = collectionId(id);
  const items = (input.items ?? []).map((item) => ({ title: String(item.title ?? "").trim(), content: String(item.content ?? "").trim() }));
  const files = (input.files ?? []).filter((path) => typeof path === "string" && path.startsWith("/"));
  const memories = (input.memories ?? []).filter((id) => Number.isInteger(id) && id > 0);
  if (items.some((item) => !item.content)) throw new Error("There's nothing to add in that text");
  if (!memories.length && !items.length && !files.length) throw new Error("Choose a memory, drop a file or paste some text first");
  return JSON.parse(await lore(loreHome, ["collection", "add", which, "-"], JSON.stringify({ memories, items, files })));
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

/** @param {string} loreHome @returns {Promise<PublicationCandidate[]>} */
async function candidates(loreHome) {
  return records(await lore(loreHome, ["publication", "candidates"]), "drafts");
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

/** Turn an agent's own history on this Mac, like Codex's, on or off. @param {string} loreHome @param {unknown} name @param {boolean} on @returns {Promise<SourceEntry>} */
async function switchSource(loreHome, name, on) {
  return JSON.parse(await lore(loreHome, ["sources", on ? "enable" : "disable", sourceName(name), "--json"], ""));
}

/** @param {string} loreHome @param {unknown} name @param {boolean} keep @returns {Promise<SourceRemoval>} */
async function removeSource(loreHome, name, keep) {
  return JSON.parse(await lore(loreHome, ["sources", "remove", sourceName(name), keep ? "--keep" : "--delete", "--json"]));
}

/** What a personal agent connected from the app can be (CAP-036). Muse has no way to take a link yet (APP-217). */
const AGENT_APPS = new Set(["grok", "chatgpt", "claude", "other"]);

/** @param {unknown} name */
function agentSource(name) {
  if (typeof name !== "string" || !/^agent-[0-9a-f]{16}$/.test(name)) throw new Error("Unknown agent");
  return name;
}

/** The owner's personal agents and what each has saved, as their store counts it. @param {string} loreHome @returns {Promise<AgentEntry[]>} */
async function listAgents(loreHome) {
  return JSON.parse(await lore(loreHome, ["agents", "list", "--json"])).agents;
}

/** A key for a new personal agent, and what to paste into it. The name follows `--` so one that starts with a dash
 * stays a name. @param {string} loreHome @param {{app?: unknown, name?: unknown}} input @returns {Promise<AgentKey>} */
async function connectAgent(loreHome, input) {
  const app = /** @type {string} */ (input?.app);
  if (!AGENT_APPS.has(app)) throw new Error("Choose an agent");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name || name.length > 40) throw new Error("An agent's name is 1 to 40 characters");
  // Attended: a key opens the owner's store, so only the owner hands one out, here or at a terminal.
  return JSON.parse(await lore(loreHome, ["agents", "connect", "--app", app, "--json", "--", name], ""));
}

/** A new key for an agent; the one it had stops working at once. @param {string} loreHome @param {unknown} source @returns {Promise<AgentKey>} */
async function agentKey(loreHome, source) {
  return JSON.parse(await lore(loreHome, ["agents", "key", agentSource(source), "--json"], ""));
}

/** Stop an agent's key, keeping or deleting what it saved. @param {string} loreHome @param {unknown} source @param {boolean} keep @returns {Promise<SourceRemoval>} */
async function disconnectAgent(loreHome, source, keep) {
  return JSON.parse(await lore(loreHome, ["agents", "revoke", agentSource(source), keep ? "--keep" : "--delete", "--json"], ""));
}

/** The plain address an app signs in at (XC-068); Lore listens for its sign-in a while after. @param {string} loreHome
 * @returns {Promise<{mcp_url: string}>} */
async function agentAddress(loreHome) {
  return JSON.parse(await lore(loreHome, ["agents", "address", "--json"]));
}

/** @param {unknown} id */
function signInId(id) {
  if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) throw new Error("Unknown sign-in");
  return id;
}

/** Let an app that asked to sign in save to Lore, as the agent the owner was connecting. Attended, like a key.
 * @param {string} loreHome @param {{id?: unknown, app?: unknown, name?: unknown}} input @returns {Promise<AllowedAgent>} */
async function allowSignIn(loreHome, input) {
  const as = AGENT_APPS.has(/** @type {string} */ (input?.app)) && typeof input.name === "string" && input.name.trim() ? ["--app", String(input.app), "--name", input.name.trim().slice(0, 40)] : [];
  return JSON.parse(await lore(loreHome, ["agents", "allow", signInId(input?.id), ...as, "--json"], ""));
}

/** @param {string} loreHome @param {unknown} id */
async function denySignIn(loreHome, id) {
  return JSON.parse(await lore(loreHome, ["agents", "deny", signInId(id), "--json"], ""));
}

/** Which agents saved something Lore hasn't brought in yet, and which apps ask to sign in. @param {string} loreHome @returns {Promise<AgentsWaiting>} */
async function agentsWaiting(loreHome) {
  return JSON.parse(await lore(loreHome, ["agents", "waiting", "--json"]));
}

/** The routines Lore runs on its own, as the CLI keeps them. @param {string} loreHome @returns {Promise<Routine[]>} */
async function listRoutines(loreHome) {
  return JSON.parse(await lore(loreHome, ["automation", "list", "--json"]));
}

/** @param {unknown} id */
function routineId(id) {
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("Unknown routine");
  return id;
}

/** When a routine runs, as the CLI's flags say it. @param {unknown} when @returns {string[]} */
function rhythmArgs(when) {
  const { cadence, hour, day = 0 } = /** @type {{cadence?: unknown, hour?: unknown, day?: unknown}} */ (when ?? {});
  if (!["daily", "weekdays", "weekly"].includes(/** @type {string} */ (cadence)) || !Number.isInteger(hour) || !Number.isInteger(day)) throw new Error("Choose when it runs");
  return ["--cadence", String(cadence), "--hour", String(hour), "--day", String(day)];
}

/** @param {string} loreHome @param {unknown} id @returns {Promise<RoutineRun>} */
async function runRoutine(loreHome, id) {
  return JSON.parse(await lore(loreHome, ["automation", "run", routineId(id), "--json"]));
}

/** Pause, resume, retime or remove a routine; the CLI refuses removing one of Lore's own.
 * @param {string} loreHome @param {unknown} id @param {unknown} action @param {unknown} [when] */
async function changeRoutine(loreHome, id, action, when) {
  if (action === "time") return lore(loreHome, ["automation", "time", routineId(id), ...rhythmArgs(when), "--json"]);
  if (action !== "pause" && action !== "resume" && action !== "remove") throw new Error("Unknown change");
  return lore(loreHome, ["automation", action, routineId(id), "--json"]);
}

/** Reword one of the owner's own. @param {string} loreHome @param {string} id @param {unknown} text @param {unknown} [title] @returns {Promise<Routine>} */
async function editRoutine(loreHome, id, text, title = "") {
  if (typeof text !== "string" || !text.trim() || text.length > 500) throw new Error("Say what Lore should do, in a sentence");
  const named = typeof title === "string" && title.trim() ? ["--title", title.trim().slice(0, 120)] : [];
  return JSON.parse(await lore(loreHome, ["automation", "edit", routineId(id), ...named, "--json", "--", text.trim()]));
}

/** One of the owner's own: a sentence, after `--` so one starting with a dash stays words. @param {string} loreHome @param {unknown} text @param {unknown} when @param {unknown} [title] A name; the sentence by default. @returns {Promise<Routine>} */
async function addRoutine(loreHome, text, when, title = "") {
  if (typeof text !== "string" || !text.trim() || text.length > 500) throw new Error("Say what Lore should do, in a sentence");
  const named = typeof title === "string" && title.trim() ? ["--title", title.trim().slice(0, 120)] : [];
  return JSON.parse(await lore(loreHome, ["automation", "add", ...rhythmArgs(when), ...named, "--json", "--", text.trim()]));
}

module.exports = {
  dollars,
  lore,
  listRoutines,
  runRoutine,
  changeRoutine,
  addRoutine,
  editRoutine,
  switchSource,
  loreStream,
  stream,
  openable,
  readState,
  readSales,
  readViews,
  searchMemories,
  readMemory,
  readGists,
  judgeMemories,
  creditMemories,
  renameMemory,
  editMemory,
  deleteMemory,
  captureMemories,
  previewPage,
  setPrice,
  setFreeCopies,
  newCollection,
  addToCollection,
  renameCollection,
  priceCollection,
  removeFromCollection,
  deleteCollection,
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
  listAgents,
  connectAgent,
  agentKey,
  disconnectAgent,
  agentsWaiting,
  agentAddress,
  allowSignIn,
  denySignIn,
  useRuntime,
  openStore,
  storeChanges,
  Outgoing,
  storeOnline,
  cloudflareSignIn,
  SIGN_IN_UNFINISHED,
  saveProfile,
  ATTENDED_KEYS,
  LaunchKey,
  useKeys,
  forgetKey,
  STORE
};
