// What the marketplace shows: the registry's markets, filled with the pieces sellers
// listed in them, read from each store's own free `discover`. Only real listings appear;
// a store that doesn't answer leaves its rows out rather than showing stale ones.

const MAINNET = "eip155:8453";
const CACHE_SECONDS = 300;
const TIMEOUT_MS = 4000;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const PIECE = /^[0-9a-f]{24}$/;

const https = (url) => {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
};
const text = (value) => (typeof value === "string" ? value.trim() : "");

/** One seller's store, read the way an agent reads it: over MCP, for free. */
export class Store {
  constructor(seller) {
    this.seller = seller;
  }

  async catalog() {
    const cache = globalThis.caches?.default;
    const key = new Request(`https://yourlore.dev/_discover?node=${encodeURIComponent(this.seller.node)}`);
    const hit = await cache?.match(key);
    if (hit) return hit.json();
    try {
      const catalog = await this.discover();
      await cache?.put(key, Response.json(catalog, { headers: { "cache-control": `max-age=${CACHE_SECONDS}` } }));
      return catalog;
    } catch {
      return null;
    }
  }

  async discover() {
    const hello = await this.post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "yourlore.dev", version: "1" } } });
    const session = hello.headers.get("mcp-session-id");
    await hello.text();
    await (await this.post({ jsonrpc: "2.0", method: "notifications/initialized" }, session)).text();
    const call = await this.post({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "discover", arguments: {} } }, session);
    return JSON.parse((await Store.payload(call)).result.content[0].text);
  }

  post(message, session) {
    return fetch(this.seller.node, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(session ? { "mcp-session-id": session } : {}) },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  }

  static async payload(response) {
    const body = await response.text();
    const data = (response.headers.get("content-type") ?? "").includes("text/event-stream") ? body.split("\n").find((line) => line.startsWith("data: "))?.slice(6) : body;
    return JSON.parse(data);
  }
}

/** Everything the store sells by id: its pieces, plus collections, which sell as one row. */
function offers(catalog, seller) {
  const price = typeof catalog?.price_usd === "number" ? catalog.price_usd : seller.price_usd;
  const found = new Map();
  for (const [topic, entries] of Object.entries(catalog?.topics ?? {})) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (PIECE.test(entry?.id) && text(entry.teaser)) {
        found.set(entry.id, { id: entry.id, question: text(entry.teaser), sample: text(entry.sample), usefulIf: text(entry.useful_if), notUsefulIf: text(entry.not_useful_if), updated: text(entry.updated_at), topic, price, pieces: 1 });
      }
    }
  }
  for (const set of Array.isArray(catalog?.collections) ? catalog.collections : []) {
    if (PIECE.test(set?.id) && text(set.title) && typeof set.price_usd === "number") {
      found.set(set.id, { id: set.id, question: text(set.title), sample: "", usefulIf: "", notUsefulIf: "", updated: "", topic: "", price: set.price_usd, pieces: set.pieces?.length ?? 0, collection: true });
    }
  }
  return found;
}

const seller = (entry) =>
  text(entry?.name) && typeof entry.price_usd === "number" && https(entry.store) && https(entry.node) && !entry.down_since
    ? {
        name: text(entry.name),
        node: entry.node,
        store: entry.store.endsWith("/") ? entry.store : `${entry.store}/`,
        price_usd: entry.price_usd,
        test: entry.network !== MAINNET,
        listed: text(entry.listed),
        publications: Number(entry.publications) || 0,
        listings: Array.isArray(entry.listings) ? entry.listings.filter((l) => SLUG.test(l?.market) && PIECE.test(l?.piece)) : []
      }
    : null;

const market = (entry) => (SLUG.test(entry?.id) && text(entry.name) && text(entry.tab) ? { id: entry.id, name: text(entry.name), tab: text(entry.tab), rows: [] } : null);

/** Every well-formed market the registry names, listed or not: a bid can ask for what nobody sells yet. */
export const registryMarkets = (list) => (Array.isArray(list?.markets) ? list.markets : []).map(market).filter(Boolean);

/** The whole exchange: markets with their rows, and the sellers behind them. */
export class Exchange {
  constructor(markets, sellers) {
    this.markets = markets;
    this.sellers = sellers;
  }

  static async load(list, read = (s) => new Store(s).catalog()) {
    const sellers = (Array.isArray(list?.sellers) ? list.sellers : []).map(seller).filter(Boolean);
    const markets = new Map(registryMarkets(list).map((m) => [m.id, m]));
    const catalogs = await Promise.all(sellers.map((s) => (s.listings.length ? read(s) : null)));
    sellers.forEach((s, i) => {
      const sold = offers(catalogs[i], s);
      s.markets = new Set();
      for (const { market: id, piece } of s.listings) {
        const offer = sold.get(piece);
        const into = markets.get(id);
        if (!offer || !into || into.rows.some((row) => row.id === piece)) continue;
        into.rows.push({ ...offer, seller: s, url: `${s.store}p/${piece}` });
        s.markets.add(id);
      }
    });
    for (const m of markets.values()) m.rows.sort((a, b) => b.updated.localeCompare(a.updated) || a.question.localeCompare(b.question));
    return new Exchange([...markets.values()].filter((m) => m.rows.length), sellers);
  }

  /** The exchange behind a registry address, or null when the registry can't be read. */
  static async from(address, read) {
    try {
      const response = await fetch(address, { cf: { cacheTtl: 300, cacheEverything: true } });
      return response.ok ? await Exchange.load(await response.json(), read) : null;
    } catch {
      return null;
    }
  }

  get pieces() {
    return this.markets.reduce((n, m) => n + m.rows.length, 0);
  }

  market(id) {
    return this.markets.find((m) => m.id === id);
  }
}

export const sellersOf = (m) => [...new Set(m.rows.map((r) => r.seller))];
