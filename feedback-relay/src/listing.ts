/**
 * List a store on the public marketplace (APP-119).
 *
 * The marketplace is `marketplace.json` in the REGISTRY repo. An entry in
 * `main` is the listing; an open pull request is the pending state. This
 * module turns one owner request into that pull request, using a
 * maintainer-held token the owner never sees, and answers "is this node
 * listed, pending, or neither".
 *
 * Nothing the owner's machine sends reaches the file except the display
 * name. Every other field of an entry is read from the node's own `discover`
 * by this Worker, so an entry can never say more than the store already
 * shows anyone who visits it.
 */
import { ReportError } from "./report.js";

export const LISTING_VERSION = 1;
export const REGISTRY = "dipakkrishnan/lore-marketplace";
export const FILE = "marketplace.json";
export const LIMITS = { name: { min: 1, max: 80 }, bodyBytes: 16_384 };
export const LENGTH_UNIT = "code_points";
export const ACTIONS = ["list", "delist"] as const;
export const STATES = ["none", "pending", "listed"] as const;
export const NODE_RE = /^https:\/\/[^/\s]+\/mcp$/;
export const SECRET_RE = /^[0-9a-f]{64}$/;

export type Action = (typeof ACTIONS)[number];
export type State = (typeof STATES)[number];

export interface Listing {
  action: Action;
  node: string;
  name: string | null;
  secret: string | null;
}

export interface Entry {
  name: string;
  node: string;
  store: string;
  network: string;
  topics: string[];
  publications: number;
  price_usd: number;
  answer_price_usd?: number;
  listed: string;
}

interface Registry {
  version: number;
  name: string;
  description?: string;
  sellers: Entry[];
}

export interface Status {
  state: State;
  action?: Action;
  pull_url?: string;
  pull_number?: number;
}

const CONTROL = /\p{Cc}/gu;

function fail(status: number, message: string): never {
  throw new ReportError(status, message);
}

export function parseListing(value: unknown): Listing {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(400, "the request must be a JSON object");
  const body = value as Record<string, unknown>;
  if (body.listing_version !== LISTING_VERSION) fail(400, `listing_version must be ${String(LISTING_VERSION)}`);
  const action = body.action;
  if (action !== "list" && action !== "delist") fail(400, "action must be list or delist");
  if (typeof body.node !== "string" || !NODE_RE.test(body.node)) fail(400, "node must be an https address ending in /mcp");
  for (const key of Object.keys(body)) {
    if (!["listing_version", "action", "node", "name", "secret"].includes(key)) fail(400, `unexpected field ${key}`);
  }
  let name: string | null = null;
  if (action === "list") {
    if (typeof body.name !== "string") fail(400, "a display name is needed");
    name = body.name.replace(CONTROL, "").trim();
    const length = [...name].length;
    if (length < LIMITS.name.min) fail(400, "a display name is needed");
    if (length > LIMITS.name.max) fail(400, `the display name is over ${String(LIMITS.name.max)} characters`);
  }
  let secret: string | null = null;
  if (action === "delist") {
    if (typeof body.secret !== "string" || !SECRET_RE.test(body.secret)) fail(400, "delisting needs the listing secret");
    secret = body.secret;
  }
  return { action, node: body.node, name, secret };
}

/** The secret a listing returns, derived so nothing has to be stored: the same
 * node always maps to the same secret under this Worker's key. */
export async function secretFor(env: Env, node: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.LORE_LISTING_KEY), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(node));
  return [...new Uint8Array(mac)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// --- the node -------------------------------------------------------------

interface Manifest {
  publication_count: number;
  topics: Record<string, unknown[]>;
  network: string;
  price_usd: number;
  answer_price_usd?: number;
}

async function mcp(node: string, message: unknown, session?: string): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "User-Agent": "lore-feedback-relay"
  };
  if (session) headers["Mcp-Session-Id"] = session;
  return fetch(node, { method: "POST", headers, body: JSON.stringify(message) });
}

async function payload(response: Response): Promise<Record<string, unknown>> {
  let text = await response.text();
  if ((response.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const line = text.split("\n").find((l) => l.startsWith("data: "));
    if (!line) fail(502, "your store answered with an empty stream");
    text = line.slice(6);
  }
  return JSON.parse(text) as Record<string, unknown>;
}

/** Read what the node advertises, the same three calls lore/snapshot.py makes. */
export async function discover(node: string): Promise<Manifest> {
  let manifest: unknown;
  try {
    const init = await mcp(node, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "lore-feedback-relay", version: "0.1" } }
    });
    if (!init.ok) fail(400, "your store did not answer");
    const session = init.headers.get("mcp-session-id");
    if (!session) fail(400, "your store did not open a session");
    await payload(init);
    await mcp(node, { jsonrpc: "2.0", method: "notifications/initialized" }, session);
    const called = await mcp(node, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "discover", arguments: {} } }, session);
    if (!called.ok) fail(400, "your store did not answer discover");
    const result = (await payload(called)).result as { content?: { text?: string }[] } | undefined;
    manifest = JSON.parse(result?.content?.[0]?.text ?? "");
  } catch (error) {
    if (error instanceof ReportError) throw error;
    console.error("discover failed", error);
    fail(400, "your store did not answer");
  }
  const m = manifest as Partial<Manifest> | null;
  if (!m || typeof m !== "object" || typeof m.publication_count !== "number" || !m.topics || typeof m.topics !== "object" || typeof m.network !== "string" || typeof m.price_usd !== "number") {
    fail(400, "your store's catalog is not in a shape the marketplace can list");
  }
  return m as Manifest;
}

export function entryFor(name: string, node: string, manifest: Manifest, today = new Date()): Entry {
  const entry: Entry = {
    name,
    node,
    store: node.slice(0, -"mcp".length),
    network: manifest.network,
    topics: Object.keys(manifest.topics).sort((a, b) => a.localeCompare(b)),
    publications: manifest.publication_count,
    price_usd: manifest.price_usd,
    listed: today.toISOString().slice(0, 10)
  };
  if (typeof manifest.answer_price_usd === "number") entry.answer_price_usd = manifest.answer_price_usd;
  return entry;
}

// --- the registry repo ----------------------------------------------------

function github(env: Env, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${env.LORE_GITHUB_API}/repos/${REGISTRY}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.LORE_MARKETPLACE_GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      "User-Agent": "lore-feedback-relay",
      ...(init.headers ?? {})
    }
  });
}

async function expect<T>(response: Response, status: number, what: string): Promise<T> {
  if (response.status !== status) {
    // Never echo GitHub's body to the client; it can carry auth detail.
    console.error(`${what}: ${String(response.status)} ${await response.text()}`);
    fail(502, `could not ${what}`);
  }
  const body: T = await response.json();
  return body;
}

function decode(base64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(base64.replace(/\s/g, "")), (c) => c.charCodeAt(0)));
}

function encode(text: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)));
}

const MARKER = "node: ";

interface Pull {
  number: number;
  html_url: string;
  body: string | null;
  head: { ref: string };
}

async function readFile(env: Env): Promise<{ registry: Registry; sha: string }> {
  const file = await expect<{ content: string; sha: string }>(await github(env, `/contents/${FILE}?ref=main`), 200, "read the marketplace");
  return { registry: JSON.parse(decode(file.content)) as Registry, sha: file.sha };
}

async function pendingFor(env: Env, node: string): Promise<Pull | undefined> {
  const pulls = await expect<Pull[]>(await github(env, "/pulls?state=open&per_page=100"), 200, "read pending listings");
  return pulls.find((pull) => pull.head.ref.startsWith("listing/") && (pull.body ?? "").split("\n").includes(MARKER + node));
}

function actionOf(pull: Pull): Action {
  return (pull.body ?? "").startsWith("Delist") ? "delist" : "list";
}

/** Listed, pending, or neither, read from the repo and never from local state. */
export async function status(env: Env, node: string): Promise<Status> {
  const pending = await pendingFor(env, node);
  if (pending) return { state: "pending", action: actionOf(pending), pull_url: pending.html_url, pull_number: pending.number };
  const { registry } = await readFile(env);
  return { state: registry.sellers.some((seller) => seller.node === node) ? "listed" : "none" };
}

async function openPull(env: Env, listing: Listing, registry: Registry, sha: string, summary: string): Promise<Pull> {
  const main = await expect<{ object: { sha: string } }>(await github(env, "/git/ref/heads/main"), 200, "read the marketplace");
  const host = new URL(listing.node).host.replace(/[^a-z0-9]+/gi, "-");
  const branch = `listing/${host}-${String(Date.now())}`;
  await expect(await github(env, "/git/refs", { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: main.object.sha }) }), 201, "start the listing");
  const content = encode(JSON.stringify(registry, null, 2) + "\n");
  await expect(await github(env, `/contents/${FILE}`, { method: "PUT", body: JSON.stringify({ message: summary, content, sha, branch }) }), 200, "write the listing");
  const body = [summary, "", `${MARKER}${listing.node}`, "", "<sub>Opened by the Lore relay from an in-app request. Merge to apply; close to decline.</sub>"].join("\n");
  return expect<Pull>(await github(env, "/pulls", { method: "POST", body: JSON.stringify({ title: summary, head: branch, base: "main", body }) }), 201, "open the listing");
}

/** An entry's fields in a fixed order, minus the listing date, so two reads of the same store compare equal. */
function canonical(entry: Entry): string {
  return JSON.stringify(Object.entries(entry).filter(([key]) => key !== "listed").sort(([a], [b]) => a.localeCompare(b)));
}

export interface Outcome extends Status {
  ok: true;
  secret?: string;
  created: boolean;
}

/** Turn one request into a pull request, or report the state it is already in. */
export async function apply(env: Env, listing: Listing): Promise<Outcome> {
  const secret = await secretFor(env, listing.node);
  if (listing.action === "delist" && !sameSecret(secret, listing.secret ?? "")) fail(403, "that is not this store's listing secret");
  const pending = await pendingFor(env, listing.node);
  if (pending) {
    const outcome: Outcome = { ok: true, created: false, state: "pending", action: actionOf(pending), pull_url: pending.html_url, pull_number: pending.number };
    if (listing.action === "list") outcome.secret = secret;
    return outcome;
  }
  const { registry, sha } = await readFile(env);
  const index = registry.sellers.findIndex((seller) => seller.node === listing.node);
  if (listing.action === "delist") {
    if (index < 0) return { ok: true, created: false, state: "none" };
    const [removed] = registry.sellers.splice(index, 1);
    const pull = await openPull(env, listing, registry, sha, `Delist ${removed.name}`);
    return { ok: true, created: true, state: "pending", action: "delist", pull_url: pull.html_url, pull_number: pull.number };
  }
  const entry = entryFor(listing.name ?? "", listing.node, await discover(listing.node));
  if (index >= 0) {
    const current = registry.sellers[index];
    if (canonical(current) === canonical(entry)) return { ok: true, created: false, state: "listed", secret };
    entry.listed = current.listed;
    registry.sellers[index] = entry;
  } else {
    registry.sellers.push(entry);
  }
  const pull = await openPull(env, listing, registry, sha, `${index >= 0 ? "Update" : "List"} ${entry.name}`);
  return { ok: true, created: true, state: "pending", action: "list", pull_url: pull.html_url, pull_number: pull.number, secret };
}
