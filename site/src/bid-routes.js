// The bid routes in contracts/bids.md. Anyone can place and read; adding answers and taking a
// bid down need the owner's token. Nothing here can mark a bid filled.
import { boardPage, boardStats } from "./bid-board.js";
import { tellBuyer } from "./bid-callback.js";
import { readAnswer, readBid } from "./bid-input.js";
import { bidPage, missingBidPage } from "./bid-pages.js";
import { publicBid } from "./bids.js";
import { Exchange, registryMarkets } from "./markets.js";

const BODY_MAX = 16_384;
const BID_PATH = /^\/b\/([^/.]+)(\.json|\/answers)?\/?$/;
const ID = /^[a-z0-9]{10}$/;
const PRIVATE = { "cache-control": "no-store" };
const PUBLIC = { ...PRIVATE, "access-control-allow-origin": "*" };

const json = (data, status = 200, headers = PRIVATE) => Response.json(data, { status, headers });
const html = (body, status = 200) => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...PRIVATE } });
const refuse = (allow) => new Response(null, { status: 405, headers: { allow } });

export const isBidPath = (path) => ["/bids", "/bids/", "/bids.json", "/bids/stats.json"].includes(path) || path.startsWith("/b/");

/** One request to a bid route. `ctx` runs buyer callbacks after the reply; `registry` loads the marketplace list, or null when it can't. */
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
    if (!id || !ID.test(id)) return rest === ".json" ? json({ error: "No bid by that id." }, 404) : html(missingBidPage(this.origin), 404);
    if (rest === ".json") return method === "GET" ? this.one(id) : refuse("GET");
    if (rest === "/answers") return method === "POST" ? this.answer(id) : refuse("POST");
    return method === "GET" ? this.page(id) : method === "DELETE" ? this.remove(id) : refuse("GET, DELETE");
  }

  async markets() {
    return registryMarkets(await this.registry());
  }

  async live() {
    return (await this.book.live()).map((found) => publicBid(found, this.origin));
  }

  /** What the board draws: live bids, the ticker's events, the registry's markets, and the exchange for asking prices. */
  async screen() {
    const list = await this.registry();
    const [bids, events, exchange] = await Promise.all([this.live(), this.book.tape(), list ? Exchange.load(list) : null]);
    return { bids, events, exchange, markets: registryMarkets(list) };
  }

  async board(error, values, status = 200) {
    return html(boardPage({ ...(await this.screen()), origin: this.origin, error, values }), status);
  }

  async stats() {
    const { bids, events, markets, exchange } = await this.screen();
    return json(boardStats(bids, events, markets, exchange), 200, PUBLIC);
  }

  async list() {
    const [bids, walked_away] = await Promise.all([this.live(), this.book.walkedAway()]);
    return json({ bids, walked_away }, 200, PUBLIC);
  }

  async one(id) {
    const found = await this.book.find(id);
    return found ? json(publicBid(found, this.origin), 200, PUBLIC) : json({ error: "No bid by that id." }, 404, PUBLIC);
  }

  async page(id) {
    const [found, markets] = await Promise.all([this.book.find(id), this.markets()]);
    return found ? html(bidPage(publicBid(found, this.origin), { markets, origin: this.origin })) : html(missingBidPage(this.origin), 404);
  }

  async place() {
    const asJson = (this.request.headers.get("content-type") ?? "").includes("application/json");
    const fail = (error, status, values = {}) => (asJson ? json({ error }, status) : this.board(error, values, status));
    if (!(await this.allowed())) return fail("Too many bids from here. Try again in a minute.", 429);
    const fields = await this.fields();
    if (!fields) return fail("Send the bid as a form or as a JSON object, under 16 KB.", 400);
    const read = readBid(fields, new Set((await this.markets()).map((m) => m.id)));
    if (read.error) return fail(read.error, 400, fields);
    const placed = await this.book.place(read.value);
    if (!placed) return fail("Lots of bids are coming in right now. Try again in a few minutes.", 429, fields);
    const { id, url, expires } = publicBid(placed, this.origin);
    if (!asJson) return Response.redirect(url, 303);
    return json({ id, url, status_url: `${url}.json`, expires }, 201);
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
