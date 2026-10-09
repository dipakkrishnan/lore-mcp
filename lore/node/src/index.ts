import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { withX402 } from "agents/x402";
import { z } from "zod";
import {
  type AnswerSettings,
  type Catalog,
  ESTIMATE_SECONDS,
  RETENTION_DISCLOSURE,
  createTicket,
  ensureAnswerSchema,
  manifest,
  readAnswerSettings,
  ticketResult,
  validPublicId
} from "./answer-state.js";
import { runAnswer } from "./answer.js";
import { type Collection, collectionCopy, collections, listing, members, toolName } from "./collections.js";
import { FEED_DAYS, bindBrowser, cardPassEnds, mintPass, passFirst, payerOf } from "./feed.js";
import { FREE_LINK, freeFirst, freeLeft, giveCopy } from "./free.js";
import { TESTNET, facilitator, network, networkLabel } from "./network.js";
import { PRICE_USD } from "./price.js";
import { type Copy, ensureReceiptSchema, keepCopy, keptCopy } from "./receipts.js";
import { type SaleKind, cardSale, ensureRefundColumn, ensureRefundTracking, ensureSalesSchema, recorded } from "./sales.js";
import {
  type Piece,
  type Store,
  collectionPage,
  feedPage,
  notFound,
  pieces,
  publicationPage,
  storefront,
  subscribedPage,
  subscriptionNotice,
  unlockedPage
} from "./storefront.js";
import { toolSpanAttributes } from "./telemetry.js";
import { withSpan } from "./tracing.js";
import { countView } from "./views.js";
import { payTo } from "./wallet.js";

const ANSWER_DISABLED = { error: "the answer tier is not enabled on this node" };
const ATTRIBUTION = "Content is owner-approved; preserve attribution when synthesizing.";

function asText(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    isError: isError || undefined
  };
}

export class LorePaidMCP extends McpAgent<Env> {
  server = withX402(
    new McpServer({ name: `Lore x402 (${networkLabel(this.env)})`, version: "0.1.0" }),
    {
      network: network(this.env),
      recipient: payTo(this.env),
      facilitator: facilitator(this.env)
    }
  );

  async runAnswerTicket(payload: { ticketId: string }) {
    await this.keepAliveWhile(() => runAnswer(this.env, payload.ticketId));
  }

  /** One paid tool per collection, since an x402 tool has one price. */
  sellCollection(set: Collection) {
    const tool = this.server.paidTool(
      toolName(set),
      `Buy the collection ${set.id} from the discover catalog: all ${set.pieces.length} of its publications in one payment.`,
      set.price_usd,
      {},
      {},
      async () =>
        withSpan("lore.collection", async (setAttributes) => {
          const found = await members(this.env.LORE_DB, set);
          setAttributes(() =>
            toolSpanAttributes({ tool: "collection", outcome: found.length ? "ok" : "not_found", paid: true, itemId: set.id })
          );
          return asText(
            found.length
              ? { collection: { id: set.id, title: set.title }, pieces: found, disclosure: ATTRIBUTION }
              : { error: `collection not found: ${set.id}` },
            !found.length
          );
        })
    );
    recorded(this.env.LORE_DB, tool, "collection", set.price_usd, () => ({ item: set.id, title: `Collection: ${set.title}` }));
  }

  /** The feed's one paid tool: a pass to every piece for FEED_DAYS, tied to the wallet that paid. */
  sellFeed(priceUsd: number, feedId: string) {
    const tool = this.server.paidTool(
      "subscribe",
      `Buy a ${FEED_DAYS}-day pass to every publication in this store, old and new, in one payment. ` +
        "Pass it to get, signed by the same wallet, to read any piece free until it expires; " +
        "call discover with since to see what's new.",
      priceUsd,
      {},
      {},
      async (_args, extra) =>
        withSpan("lore.subscribe", async (setAttributes) => {
          const minted = await mintPass(this.env.LORE_DB, payerOf(extra));
          setAttributes(() => toolSpanAttributes({ tool: "subscribe", outcome: "ok", paid: true }));
          return asText({
            ...minted,
            covers: "every piece in this store, old and new",
            how:
              "call get with this pass, signed_at and signature (the paying wallet's signature over " +
              "'Lore pass <pass> for <id> at <signed_at>') to read any piece free until it expires; " +
              "call discover with since to see what's new"
          });
        })
    );
    recorded(this.env.LORE_DB, tool, "feed", priceUsd, () => ({ item: feedId || "feed", title: `Feed, ${FEED_DAYS} days` }));
  }

  async init() {
    await ensureAnswerSchema(this.env.LORE_DB);
    await ensureSalesSchema(this.env.LORE_DB);
    await ensureRefundTracking(this.env.LORE_DB);
    const settings = await readAnswerSettings(this.env.LORE_DB);
    const sets = await collections(this.env.LORE_DB);
    this.server.registerTool(
      "discover",
      {
        description:
          "Return this node's full catalog of owner-approved publications: " +
          "teasers grouped by topic, with ids, freshness, and price. Free. " +
          "Choose zero, one, multiple, or all ids; call get once per chosen id.",
        inputSchema: {
          since: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/, { message: "since is a date like 2026-10-09" })
            .optional()
            .describe("Only pieces updated on or after this day (YYYY-MM-DD), to see what's new.")
        }
      },
      async ({ since }) =>
        withSpan("lore.discover", async (setAttributes) => {
          setAttributes(() => toolSpanAttributes({ tool: "discover", outcome: "ok" }));
          return asText({
            ...newSince(await manifest(this.env), since),
            network: network(this.env),
            payout: payTo(this.env),
            price_usd: priceOf(settings),
            listed: settings.listedName !== "",
            ...(sets.length ? { collections: sets.map((set) => listing(set, priceOf(settings))) } : {}),
            ...(settings.feedPriceUsd ? { feed: { price_usd: settings.feedPriceUsd, days: FEED_DAYS, tool: "subscribe" } } : {}),
            ...(settings.freeCopies ? { free_copies: settings.freeCopies } : {}),
            ...(settings.listedName ? { name: settings.listedName } : {}),
            ...(settings.enabled
              ? {
                  answer_price_usd: settings.priceUsd,
                  answer_retention_disclosure: RETENTION_DISCLOSURE
                }
              : {}),
            disclosure:
              "Choose any advertised ids; get buys one publication per call." +
              (sets.length ? " Each collection's tool buys all of its pieces in one call." : "") +
              (settings.feedPriceUsd ? ` subscribe buys a ${FEED_DAYS}-day pass; get with that pass reads any piece free.` : "") +
              (settings.freeCopies ? ` The first ${settings.freeCopies} copies of each are free, while they last.` : "")
          });
        })
    );

    const publication = (id: string) =>
      this.env.LORE_DB.prepare(
        `SELECT public_id AS id, title, content, topic, kind, updated_at
         FROM publications WHERE public_id = ?1`
      )
        .bind(id)
        .first<{ id: string; title: string }>();
    const get = this.server.paidTool(
      "get",
      "Fetch one owner-approved publication by its id from the discover catalog. " +
        "Each call buys exactly one publication. Damaged ids are rejected before " +
        "payment, and an id that is no longer for sale returns an error and is never charged.",
      priceOf(settings),
      {
        id: z.string().trim().refine(validPublicId, {
          message: "invalid publication id; run discover again"
        }),
        pass: z.string().trim().optional().describe("A feed pass from subscribe; while valid, get charges nothing."),
        signed_at: z.string().trim().optional().describe("With pass: when the signature was made (ISO time), within 10 minutes of now."),
        signature: z
          .string()
          .trim()
          .optional()
          .describe("With pass: the paying wallet's signature over 'Lore pass <pass> for <id> at <signed_at>'.")
      },
      {},
      async ({ id }) =>
        withSpan("lore.get", async (setAttributes) => {
          const row = await publication(id);
          setAttributes(() =>
            toolSpanAttributes({ tool: "get", outcome: row ? "ok" : "not_found", paid: true, itemId: id })
          );
          return asText(
            row
              ? {
                  publication: row,
                  disclosure: ATTRIBUTION
                }
              : { error: `publication not found: ${id}` },
            !row
          );
        })
    );
    recorded(this.env.LORE_DB, get, "publication", priceOf(settings), (payload) => {
      const { publication } = payload as { publication: { id: string; title: string } };
      return { item: publication.id, title: publication.title };
    });
    freeFirst(this.env.LORE_DB, get, publication, (row) =>
      asText({
        publication: row,
        free_copy: true,
        disclosure: `A free copy: the seller gives the first few away, so nothing was charged. ${ATTRIBUTION}`
      })
    );

    passFirst(this.env.LORE_DB, get, publication, (row) =>
      asText({ publication: row, feed_pass: true, disclosure: `Read with a feed pass, so nothing was charged. ${ATTRIBUTION}` })
    );

    for (const set of sets) this.sellCollection(set);
    if (settings.feedPriceUsd) this.sellFeed(settings.feedPriceUsd, settings.feedId);

    const question = {
      question: z.string().trim().min(1).max(4000)
    };
    const answerDescription =
      "Buy a response from the owner's authorized AI proxy, grounded in the " +
      "owner's approved publications. Payment settles at submission and returns a ticket " +
      "immediately; poll result until it completes. Questions are retained and " +
      "visible to the owner. Unsupported questions are refused after payment. " +
      "Refunds are not automatic: a refused or failed answer is marked owed back to " +
      "your paying address, and the owner refunds it.";

    if (settings.enabled) {
      const answer = this.server.paidTool(
        "answer",
        answerDescription,
        settings.priceUsd,
        question,
        {},
        async (args) =>
          withSpan("lore.answer", async (setAttributes) => {
            const ticket = await createTicket(this.env, args.question, settings.priceUsd);
            await this.schedule(0, "runAnswerTicket", { ticketId: ticket });
            setAttributes(() => toolSpanAttributes({ tool: "answer", outcome: "ok", paid: true, itemId: ticket }));
            return asText({
              ticket,
              status: "running",
              poll: "result",
              estimate_seconds: ESTIMATE_SECONDS,
              retention_disclosure: RETENTION_DISCLOSURE
            });
          })
      );
      recorded<typeof question>(this.env.LORE_DB, answer, "answer", settings.priceUsd, (payload, args) => ({
        item: (payload as { ticket: string }).ticket,
        title: args.question
      }));
    } else {
      this.server.registerTool(
        "answer",
        { description: answerDescription, inputSchema: question },
        async () =>
          withSpan("lore.answer", (setAttributes) => {
            setAttributes(() => toolSpanAttributes({ tool: "answer", outcome: "disabled" }));
            return asText(ANSWER_DISABLED, true);
          })
      );
    }

    this.server.registerTool(
      "result",
      {
        description:
          "Fetch the outcome of a paid answer ticket. Free and idempotent; keep " +
          "polling while status is running. Terminal statuses: complete, refused " +
          "(no coverage), failed (agent error or timeout). Refused and failed answers are " +
          "marked owed back; the owner refunds them.",
        inputSchema: {
          ticket: z.string().trim().refine(validPublicId, {
            message: "invalid ticket id; use the one answer returned"
          })
        }
      },
      async (args) =>
        withSpan("lore.result", async (setAttributes) => {
          const outcome = await ticketResult(this.env, args.ticket);
          const found = !("error" in outcome);
          setAttributes(() =>
            toolSpanAttributes({
              tool: "result",
              outcome: found ? "ok" : "not_found",
              itemId: args.ticket
            })
          );
          return asText(outcome, !found);
        })
    );
  }
}

/** The catalog as of `since`: only pieces updated that day or later, for a subscriber checking what's new. */
function newSince(catalog: Catalog, since?: string): Catalog {
  if (!since) return catalog;
  const topics = Object.fromEntries(
    Object.entries(catalog.topics)
      .map(([topic, entries]) => [topic, entries.filter((entry) => entry.updated_at >= since)] as const)
      .filter(([, entries]) => entries.length)
  );
  return { ...catalog, topics, publication_count: Object.values(topics).flat().length };
}

const mcp = LorePaidMCP.serve("/mcp", { binding: "LorePaidMCP" });

/** Cards can't charge less, so a store priced below this offers no card checkout. */
const CARD_MINIMUM_USD = 0.5;
const STRIPE_ACCOUNT = /^acct_[A-Za-z0-9]+$/;
const SESSION = /^cs_[A-Za-z0-9_]+$/;
const PUBLIC = { "cache-control": "public, max-age=60" };
const PRIVATE = { "cache-control": "private, no-store", "referrer-policy": "no-referrer" };
const html = (body: string | null, status: number, cache: Record<string, string>) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8", ...cache } });

type Receipt = { paid: boolean; piece?: string; origin?: string; payment_intent?: string; amount_usd?: number };
type Paid = { tx: string; priceUsd: number };

/** Ask Lore's checkout whether this receipt paid for this piece in this store; anything else, including an outage, is no. */
async function paidFor(env: Env, account: string, session: string, piece: { id: string }, origin: string): Promise<Paid | null> {
  try {
    const query = new URLSearchParams({ session, account });
    const response = await fetch(`${env.CHECKOUT_URL}/verify?${query}`);
    if (!response.ok) return null;
    const receipt: Receipt = await response.json();
    const tx = receipt.payment_intent ?? "";
    const matches = receipt.paid && receipt.piece === piece.id && receipt.origin === origin && tx;
    return matches ? { tx, priceUsd: receipt.amount_usd ?? 0 } : null;
  } catch {
    return null;
  }
}

type Settled = Paid & { id: string; title: string; kind: SaleKind; copy: Copy | null };

/** What a card can buy here: one piece, a whole collection kept as one copy, or a 30-day subscription. */
type Sellable = {
  id: string;
  teaser: string;
  priceUsd: number;
  kind: SaleKind;
  /** Set for a piece; a collection's receipt is drawn from its kept copy. */
  piece?: Piece;
  /** The sale's title in the ledger. */
  sold: (copy: Copy) => string;
  copy: () => Promise<Copy | null>;
  page: (store: Store, problem: string, left?: number) => string;
};

async function pieceCopy(db: D1Database, found: Piece): Promise<Copy | null> {
  const current = await db
    .prepare("SELECT title, content FROM publications WHERE public_id = ?1")
    .bind(found.id)
    .first<{ title: string; content: string }>();
  return current && { piece_id: found.id, teaser: found.teaser, kind: found.kind, updated_at: found.updated_at, ...current };
}

function sellable(env: Env, catalog: Catalog, sets: Collection[], settings: AnswerSettings, id: string): Sellable | undefined {
  const all = pieces(catalog);
  const found = all.find((piece) => piece.id === id);
  if (found) {
    return {
      id,
      teaser: found.teaser,
      priceUsd: priceOf(settings),
      kind: "publication",
      piece: found,
      sold: (copy) => copy.title,
      copy: () => pieceCopy(env.LORE_DB, found),
      page: (store, problem, left = 0) => publicationPage(found, store, problem, left)
    };
  }
  if (settings.feedPriceUsd && settings.feedId === id) {
    const teaser = `${settings.listedName || "This store"} feed: ${FEED_DAYS} days of everything`;
    return {
      id,
      teaser,
      priceUsd: settings.feedPriceUsd,
      kind: "feed",
      sold: () => `Feed, ${FEED_DAYS} days`,
      copy: async () => ({ piece_id: id, teaser, kind: "feed", updated_at: new Date().toISOString().slice(0, 10), title: `Feed, ${FEED_DAYS} days`, content: "" }),
      page: (store, problem) => feedPage(id, all, store, problem)
    };
  }
  const set = sets.find((candidate) => candidate.id === id);
  if (!set) return undefined;
  const entries = set.pieces.flatMap((member) => all.filter((piece) => piece.id === member));
  return {
    id,
    teaser: set.title,
    priceUsd: set.price_usd,
    kind: "collection",
    sold: (copy) => `Collection: ${copy.title}`,
    copy: () => collectionCopy(env.LORE_DB, set),
    page: (store, problem) => collectionPage(set, entries, store, priceOf(settings), problem)
  };
}

/** A payment checkout confirms into this store's account, for this item in this store, and what it
 * bought: the item as it stands, or nothing if it has since been taken down. */
async function settled(env: Env, account: string, session: string, id: string, origin: string, item?: Sellable): Promise<Settled | null> {
  const paid = SESSION.test(session) && STRIPE_ACCOUNT.test(account) ? await paidFor(env, account, session, { id }, origin) : null;
  if (!paid) return null;
  const copy = item ? await item.copy() : null;
  const title = copy && item ? item.sold(copy) : (item?.teaser ?? "A piece since taken down");
  return { ...paid, id, title, kind: item?.kind ?? "publication", copy };
}

/** Keep the copy and count the sale together, once each; a payment with nothing left to keep is owed back. */
async function keep(env: Env, session: string, sale: Settled): Promise<void> {
  const db = env.LORE_DB;
  await Promise.all([ensureReceiptSchema(db), ensureRefundColumn(db)]);
  await db.batch([
    ...(sale.copy ? [keepCopy(db, session, sale.copy)] : []),
    cardSale(db, { kind: sale.kind, item: sale.id, title: sale.title, priceUsd: sale.priceUsd, tx: sale.tx, refundOwed: !sale.copy })
  ]);
}

async function receiptPage(request: Request, env: Env, store: Store, account: string, session: string, id: string, item: Sellable | undefined): Promise<Response> {
  // A kept copy opens whatever happened since: an edit, a takedown, or cards turned off.
  const free = FREE_LINK.test(session);
  const kept = SESSION.test(session) || free ? await keptCopy(env.LORE_DB, session, id) : null;
  const sale = kept || !item ? null : await settled(env, account, session, id, store.origin, item);
  // The buyer has paid; a bookkeeping failure must never cost them the piece.
  if (sale) await keep(env, session, sale).catch(() => console.error("receiptPage(): failed to keep a paid card session"));
  const copy = kept ?? sale?.copy;
  if (copy?.kind === "feed") return subscribed(request, env, store, session, id, copy, item);
  if (copy) {
    const piece = item?.piece ?? { id, teaser: copy.teaser, kind: copy.kind, updated_at: copy.updated_at, topic: "", section: 0 };
    return html(unlockedPage(piece, store, copy, free), 200, PRIVATE);
  }
  if (!item) return html(notFound(store), 404, PRIVATE);
  const problem = free
    ? "This link doesn't open a free copy here."
    : `We couldn't find a finished card payment for this ${item.piece ? "piece" : item.kind === "feed" ? "subscription" : "collection"}. If you just paid, wait a minute and reload this page.`;
  return html(item.page(store, problem), 200, PRIVATE);
}

const FEED_COOKIE = /(?:^|;\s*)lore_feed=(browser_[0-9a-f]{32})/;

/** A card subscriber's receipt: every piece in full while the 30 days last, in the browser that first opened it.
 * It keeps opening after the seller turns the feed off. */
async function subscribed(request: Request, env: Env, store: Store, session: string, id: string, copy: Copy, item: Sellable | undefined): Promise<Response> {
  const db = env.LORE_DB;
  const bound = await bindBrowser(db, session, request.headers.get("cookie")?.match(FEED_COOKIE)?.[1]);
  if (!bound) {
    return html(subscriptionNotice(store, "This subscription opens in the browser it was bought in.", "Open this link there. If you can't, write to the seller."), 403, PRIVATE);
  }
  const ends = cardPassEnds(copy.bought_at ?? new Date().toISOString());
  const response =
    ends.getTime() <= Date.now()
      ? item
        ? html(item.page(store, "Your 30 days ended. Subscribe again to keep reading."), 200, PRIVATE)
        : html(subscriptionNotice(store, "Your 30 days ended.", "This store doesn't sell subscriptions right now."), 200, PRIVATE)
      : html(
          subscribedPage(
            id,
            store,
            (
              await db
                .prepare("SELECT title, content, kind, updated_at FROM publications WHERE teaser <> '' ORDER BY updated_at DESC, public_id")
                .all<{ title: string; content: string; kind: string; updated_at: string }>()
            ).results,
            ends
          ),
          200,
          PRIVATE
        );
  if (bound.fresh) {
    const seconds = Math.max(0, Math.ceil((ends.getTime() - Date.now()) / 1000));
    response.headers.set("set-cookie", `lore_feed=${bound.browser}; Path=/p/${id}; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Lax`);
  }
  return response;
}

const FREE_COOKIE = /(?:^|;\s*)lore_free=(free_[0-9a-f]{32})/;

/** A reader taking a free copy, kept under a link of its own like a card receipt. A browser that
 * already took one is sent back to it instead of spending another. */
async function readFree(request: Request, env: Env, store: Store, id: string, found: Piece | undefined): Promise<Response> {
  const db = env.LORE_DB;
  await Promise.all([ensureReceiptSchema(db), ensureRefundColumn(db)]);
  const cookie = request.headers.get("cookie")?.match(FREE_COOKIE)?.[1];
  const mine = cookie && (await keptCopy(db, cookie, id)) ? cookie : null;
  const copy = mine || !found ? null : await pieceCopy(db, found);
  const link = mine ?? (copy ? await giveCopy(db, copy, store.freeCopies ?? 0) : null);
  if (link) {
    const cookie = `lore_free=${link}; Path=/p/${id}; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`;
    return new Response(null, { status: 303, headers: { location: `/p/${id}?session_id=${link}`, "set-cookie": cookie, ...PRIVATE } });
  }
  if (!found) return html(notFound(store), 404, PRIVATE);
  return html(publicationPage(found, store, "There are no free copies of this piece left."), 200, PRIVATE);
}

function storeFor(env: Env, url: URL, settings: AnswerSettings, priceUsd = priceOf(settings)): Store {
  return {
    name: settings.listedName,
    priceUsd,
    origin: url.origin,
    test: network(env) === TESTNET,
    freeCopies: settings.freeCopies,
    support: settings.supportEmail,
    ...(settings.feedPriceUsd ? { feedUsd: settings.feedPriceUsd } : {}),
    ...(settings.feedPriceUsd && settings.feedId ? { feedId: settings.feedId } : {}),
    ...(takesCards(settings, priceUsd) ? { checkout: env.CHECKOUT_URL } : {})
  };
}

const takesCards = (settings: AnswerSettings, priceUsd: number) => STRIPE_ACCOUNT.test(settings.stripeAccount) && priceUsd >= CARD_MINIMUM_USD;
/** What a piece costs: the owner's pushed price, so a new price needs no redeploy; the deployed one until a push carries it. */
const priceOf = (settings: AnswerSettings) => settings.publicationPriceUsd || PRICE_USD;

/** Lore's checkout saying a card payment finished, so the sale counts even if the buyer never returns. The
 * notice only names a session: it is checked with checkout before anything is written. */
async function paidNotice(request: Request, env: Env, account: string, origin: string, id: string, item: Sellable | undefined): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const session = form?.get("session_id");
  if (typeof session !== "string") return Response.json({ recorded: false }, { status: 400, headers: PRIVATE });
  // Only the account this store takes cards into; nothing in the notice names the payee.
  const sale = await settled(env, account, session, id, origin, item);
  if (!sale) return Response.json({ recorded: false }, { status: 404, headers: PRIVATE });
  // A failed write answers 5xx, so checkout fails the webhook and Stripe sends it again.
  return keep(env, session, sale).then(
    () => Response.json({ recorded: true }, { headers: PRIVATE }),
    () => Response.json({ recorded: false }, { status: 503, headers: PRIVATE })
  );
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const page = url.pathname === "/" || /^\/p(\/|$)/.test(url.pathname);
    if (page && (request.method === "GET" || request.method === "HEAD")) {
      const [catalog, settings, sets] = await Promise.all([manifest(env), readAnswerSettings(env.LORE_DB), collections(env.LORE_DB)]);
      const [, id, format] = url.pathname.match(/^\/p\/([0-9a-f]{24})(\.json|\/)?$/) ?? [];
      const item = id ? sellable(env, catalog, sets, settings, id) : undefined;
      const store = storeFor(env, url, settings, item?.priceUsd);
      if (format === ".json") {
        // What Lore's checkout reads before charging: only what the page already shows, plus the payee.
        const forSale = item && {
          id: item.id,
          teaser: item.teaser,
          price_usd: item.priceUsd,
          stripe_account: takesCards(settings, item.priceUsd) ? settings.stripeAccount : "",
          test: store.test
        };
        return Response.json(forSale ?? { error: "not for sale here" }, { status: forSale ? 200 : 404, headers: PUBLIC });
      }
      const session = url.searchParams.get("session_id");
      if (id && session !== null) {
        const response = await receiptPage(request, env, store, settings.stripeAccount, session, id, item);
        return request.method === "HEAD" ? html(null, response.status, PRIVATE) : response;
      }
      // Counted after the response; a buyer reopening their receipt returned above and is never a view.
      if (item && request.method === "GET") ctx.waitUntil(countView(env.LORE_DB, item.id).catch(() => undefined));
      const left = item?.piece ? await freeLeft(env.LORE_DB, item.id, settings.freeCopies) : 0;
      const body = url.pathname === "/" ? storefront(catalog, store, sets) : item ? item.page(store, "", left) : notFound(store);
      return html(request.method === "HEAD" ? null : body, url.pathname === "/" || item ? 200 : 404, PUBLIC);
    }
    const [, posted, action] = url.pathname.match(/^\/p\/([0-9a-f]{24})\/(paid|free)$/) ?? [];
    if (posted && request.method === "POST") {
      const [catalog, settings, sets] = await Promise.all([manifest(env), readAnswerSettings(env.LORE_DB), collections(env.LORE_DB)]);
      const item = sellable(env, catalog, sets, settings, posted);
      return action === "free"
        ? readFree(request, env, storeFor(env, url, settings), posted, item?.piece)
        : paidNotice(request, env, settings.stripeAccount, url.origin, posted, item);
    }
    const response = await mcp.fetch(request, env, ctx);
    if (response.webSocket || response.headers.has("cache-control")) return response;
    const uncached = new Response(response.body, response);
    uncached.headers.set("cache-control", "no-store");
    return uncached;
  }
};
