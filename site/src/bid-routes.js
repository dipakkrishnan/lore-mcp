// The bid routes in contracts/bids.md. Anyone can place and read; the buyer, holding the key
// their bid was placed with, accepts an answer and updates their card; adding answers and
// taking a bid down need the owner's token. Nothing here can mark a bid filled.
import { boardPage, boardStats } from "./bid-board.js";
import { tellBuyer } from "./bid-callback.js";
import { readAnswer, readBid } from "./bid-input.js";
import { bidPage, missingBidPage } from "./bid-pages.js";
import { declined, publicBid, receiptUrl } from "./bids.js";
import { countDemand } from "./demand.js";
import { homePage } from "./home.js";
import { registryMarkets } from "./markets.js";

const BODY_MAX = 16_384;
const BID_PATH = /^\/b\/([^/.]+)(\.json|\/answers|\/accept|\/card)?\/?$/;
const ID = /^[a-z0-9]{10}$/;
const KEY = /^[a-z0-9]{32}$/;
const KEY_DAYS = 30;
const PRIVATE = { "cache-control": "no-store" };
const PUBLIC = { ...PRIVATE, "access-control-allow-origin": "*" };

const json = (data, status = 200, headers = PRIVATE) => Response.json(data, { status, headers });
const html = (body, status = 200, cache = "no-store") => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache } });
const refuse = (allow) => new Response(null, { status: 405, headers: { allow } });
const go = (location, cookie) => new Response(null, { status: 303, headers: { location, ...PRIVATE, ...(cookie ? { "set-cookie": cookie } : {}) } });
/** The buyer's key, kept by their browser for this bid's pages only. */
const keyCookie = (id, key) => `lore_bid_${id}=${key}; Path=/b/${id}; Max-Age=${KEY_DAYS * 86_400}; Secure; HttpOnly; SameSite=Lax`;

export const isBidPath = (path) => ["/bids", "/bids/", "/bids.json", "/bids/stats.json"].includes(path) || path.startsWith("/b/");

/** One request to a bid route, or to the home page, which is drawn around the live bids. `ctx` runs buyer callbacks after the reply; `registry` loads the marketplace list, or null when it can't. */
export class BidDesk {
  constructor(request, env, ctx, registry) {
    this.request = request;
    this.env = env;
    this.ctx = ctx;
    this.registry = registry;
    this.origin = new URL(request.url).origin;
    this.book = env.BIDS.get(env.BIDS.idFromName("book"));
  }

  async respond() {
    const { pathname } = new URL(this.request.url);
    const method = this.request.method;
    if (pathname === "/bids.json") return method === "GET" ? this.list() : refuse("GET");
    if (pathname === "/bids/stats.json") return method === "GET" ? this.stats() : refuse("GET");
    if (pathname === "/bids" || pathname === "/bids/") return method === "GET" ? this.board() : method === "POST" ? this.place() : refuse("GET, POST");
    const [, id, rest] = pathname.match(BID_PATH) ?? [];
    if (!id || !ID.test(id)) return rest === ".json" ? json({ error: "No bid by that id." }, 404) : html(missingBidPage(), 404);
    if (rest === ".json") return method === "GET" ? this.one(id) : refuse("GET");
    if (rest === "/answers") return method === "POST" ? this.answer(id) : refuse("POST");
    if (rest === "/accept") return method === "POST" ? this.accept(id) : refuse("POST");
    if (rest === "/card") return method === "POST" ? this.card(id) : refuse("POST");
    return method === "GET" ? this.page(id) : method === "DELETE" ? this.remove(id) : refuse("GET, DELETE");
  }

  async markets() {
    return registryMarkets(await this.registry());
  }

  async live() {
    return (await this.book.live()).map((found) => publicBid(found, this.origin));
  }

  /** Live bids and the registry's markets; with the book unreachable, no bids rather than an error page. */
  async screen() {
    const [bids, markets] = await Promise.all([this.live().catch(() => []), this.markets()]);
    return { bids, markets };
  }

  async board(error, values, status = 200) {
    const params = new URL(this.request.url).searchParams;
    return html(boardPage({ ...(await this.screen()), market: params.get("market") ?? "", ask: params.has("ask"), error, values }), status);
  }

  async stats() {
    const { bids, markets } = await this.screen();
    return json(boardStats(bids, markets, new URL(this.request.url).searchParams.get("market") ?? ""), 200, PUBLIC);
  }

  /** The home page, drawn around the live bids. */
  async home() {
    return html(homePage({ bids: await this.live().catch(() => []) }), 200, "public, max-age=60");
  }

  async list() {
    const [bids, walked_away] = await Promise.all([this.live(), this.book.walkedAway()]);
    return json({ bids, walked_away }, 200, PUBLIC);
  }

  /** The public shape; the buyer, sending their key, also gets their receipt and any payment problem. */
  async one(id) {
    const mine = await this.buyer(id);
    const found = mine?.found ?? (await this.book.find(id));
    if (!found) return json({ error: "No bid by that id." }, 404, PUBLIC);
    if (!mine) return json(publicBid(found, this.origin), 200, PUBLIC);
    return json({ ...publicBid(found, this.origin), receipt_url: receiptUrl(found), payment_problem: declined(found.events)?.data.message ?? null });
  }

  async page(id, error = "", status = 200) {
    const given = new URL(this.request.url).searchParams.get("key");
    const [mine, markets] = await Promise.all([this.buyer(id, given), this.markets()]);
    const found = mine?.found ?? (await this.book.find(id));
    if (!found) return html(missingBidPage(), 404);
    const buyer = mine && { key: mine.key, receipt: receiptUrl(found), problem: declined(found.events)?.data.message ?? "", error };
    const response = html(bidPage(publicBid(found, this.origin), { markets, buyer }), status);
    if (mine && given === mine.key) response.headers.set("set-cookie", keyCookie(id, mine.key));
    return response;
  }

  async place() {
    const asJson = (this.request.headers.get("content-type") ?? "").includes("application/json");
    const fail = (error, status, values = {}) => (asJson ? json({ error }, status) : this.board(error, values, status));
    if (!(await this.allowed())) return fail("Too many bids from here. Try again in a minute.", 429);
    const fields = await this.fields();
    if (!fields) return fail("Send the bid as a form or as a JSON object, under 16 KB.", 400);
    const read = readBid(fields, new Set((await this.markets()).map((m) => m.id)));
    if (read.error) return fail(read.error, 400, fields);
    // A person's bid always carries a card. An agent's bid may go without one, and is then
    // shown as "no card on file" and listed below carded bids (MON-054).
    const card = !asJson || fields.card === true;
    const placed = await this.book.place(read.value, { card });
    if (!placed) return fail("Lots of bids are coming in right now. Try again in a few minutes.", 429, fields);
    countDemand("agent.bid", this.request, this.env, this.ctx);
    const { id, url, expires } = publicBid(placed.found, this.origin);
    const made = { id, url, status_url: `${url}.json`, expires, card };
    if (!card) return asJson ? json(made, 201) : go(url);
    const setup = await this.setup(id, read.value.question);
    if (!setup) {
      await this.book.abandon(id);
      return fail("Saving a card isn't working right now. Try again in a minute.", 502, fields);
    }
    if (asJson) return json({ ...made, card_url: setup, key: placed.key, manage_url: `${url}?key=${placed.key}` }, 201);
    return go(setup, keyCookie(id, placed.key));
  }

  /** Stripe's page for saving a card to this bid, or null when checkout can't make one. */
  async setup(id, question, customer = null) {
    try {
      return (await this.env.CHECKOUT.setup({ bid: id, question, customer, return_url: `${this.origin}/b/${id}` })).url ?? null;
    } catch (error) {
      console.error(`bid ${id}: card setup failed: ${error.message}`);
      return null;
    }
  }

  /** The buyer accepts one answer; their card is then charged, straight to that seller. */
  async accept(id) {
    const fields = await this.fields();
    const asJson = (this.request.headers.get("content-type") ?? "").includes("application/json");
    const answer = Number(fields?.answer);
    const result = await this.book.accept(id, this.key(), answer);
    const problem = {
      missing: [403, "Only the person who placed this bid can accept an answer."],
      card: [409, "Add your card before accepting an answer."],
      state: [409, "That answer can't be accepted now."]
    }[result];
    if (asJson) return problem ? json({ error: problem[1] }, problem[0]) : json(publicBid(result, this.origin), 202);
    return problem ? this.page(id, problem[1], problem[0]) : go(`/b/${id}`);
  }

  /** The buyer saves a card, or a new one after a decline; Stripe's page comes back here. */
  async card(id) {
    const mine = await this.buyer(id);
    const asJson = (this.request.headers.get("content-type") ?? "").includes("application/json");
    const fail = (error, status) => (asJson ? json({ error }, status) : mine ? this.page(id, error, status) : html(missingBidPage(), 404));
    if (!mine) return fail("Only the person who placed this bid can change its card.", 403);
    const { bid, events } = mine.found;
    if (!["pending", "open", "answered"].includes(publicBid(mine.found, this.origin).status) || (bid.card && !declined(events))) {
      return fail("This bid's card can't be changed now.", 409);
    }
    const setup = await this.setup(id, bid.question, mine.customer);
    if (!setup) return fail("Saving a card isn't working right now. Try again in a minute.", 502);
    return asJson ? json({ card_url: setup }) : go(setup);
  }

  /** The key a buyer sent: `?key=` on a page, `Authorization: Bearer` from an agent, or the bid's cookie. */
  key(given = null) {
    const bearer = (this.request.headers.get("authorization") ?? "").match(/^Bearer (.+)$/)?.[1];
    const [, id] = new URL(this.request.url).pathname.match(BID_PATH) ?? [];
    const cookie = (this.request.headers.get("cookie") ?? "").match(new RegExp(`(?:^|;\\s*)lore_bid_${id}=([a-z0-9]{32})`))?.[1];
    const key = given ?? bearer ?? cookie ?? null;
    return key && KEY.test(key) ? key : null;
  }

  /** The bid and the buyer's key, when the request holds it. */
  async buyer(id, given = null) {
    const key = this.key(given) ?? this.key();
    const mine = key && (await this.book.buyer(id, key));
    return mine ? { ...mine, key } : null;
  }

  async answer(id) {
    if (!(await this.owner())) return json({ error: "Adding an answer needs the owner's token." }, 401);
    const fields = await this.fields();
    if (!fields) return json({ error: "Send the answer as a JSON object, under 16 KB." }, 400);
    const read = readAnswer(fields);
    if (read.error) return json({ error: read.error }, 400);
    const result = await this.book.answer(id, read.value);
    if (result === "missing") return json({ error: "No bid by that id." }, 404);
    if (result === "ended") return json({ error: "This bid has ended." }, 409);
    const bid = publicBid(result.found, this.origin);
    if (result.callback) this.ctx.waitUntil(tellBuyer(result.callback, bid));
    return json(bid, 201);
  }

  async remove(id) {
    if (!(await this.owner())) return json({ error: "Taking a bid down needs the owner's token." }, 401);
    return (await this.book.remove(id)) ? json({ id, status: "removed" }) : json({ error: "No bid by that id." }, 404);
  }

  /** Per client and site-wide, on the rate-limit bindings. The address is only a bucket key; nothing stores it. */
  async allowed() {
    const client = this.request.headers.get("cf-connecting-ip") ?? "unknown";
    const checks = [this.env.BID_RATE_LIMIT?.limit({ key: client }), this.env.BID_GLOBAL_RATE_LIMIT?.limit({ key: "global" })];
    return (await Promise.all(checks)).every((result) => !result || result.success);
  }

  async owner() {
    const token = this.env.BIDS_ADMIN_TOKEN;
    const given = (this.request.headers.get("authorization") ?? "").match(/^Bearer (.+)$/)?.[1];
    if (!token || !given) return false;
    const digest = (text) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    const [a, b] = await Promise.all([digest(given), digest(token)]);
    return crypto.subtle.timingSafeEqual(a, b);
  }

  /** The body as plain fields, from a form post or a JSON object; null when it is neither or too big. */
  async fields() {
    if (Number(this.request.headers.get("content-length")) > BODY_MAX) return null;
    const bytes = await this.request.arrayBuffer();
    if (bytes.byteLength > BODY_MAX) return null;
    const body = new TextDecoder().decode(bytes);
    if ((this.request.headers.get("content-type") ?? "").includes("application/json")) {
      try {
        const parsed = JSON.parse(body);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
      } catch {
        return null;
      }
    }
    return Object.fromEntries(new URLSearchParams(body));
  }
}
