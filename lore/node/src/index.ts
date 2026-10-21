import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { withX402 } from "agents/x402";
import { z } from "zod";
import { isAgentPath, serveAgent, signIn } from "./agent.js";
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
import { answerReadiness, runAnswer } from "./answer.js";
import { FREE_LINK, freeFirst, freeLeft, giveCopy } from "./free.js";
import { TESTNET, facilitator, network, networkLabel } from "./network.js";
import { PRICE_USD } from "./price.js";
import { type Copy, ensureReceiptSchema, keepCopy, keptCopy } from "./receipts.js";
import { cardSale, ensureRefundColumn, ensureRefundTracking, ensureSalesSchema, recorded } from "./sales.js";
import { SignIn } from "./signin.js";
import { type Piece, type Store, notFound, pieces, publicationPage, storefront, unlockedPage } from "./storefront.js";
import { toolSpanAttributes } from "./telemetry.js";
import { withSpan } from "./tracing.js";
import { countView } from "./views.js";
import { payTo, takesAgentPayments } from "./wallet.js";

const ANSWER_DISABLED = { error: "the answer tier is not enabled on this node" };
const answerUnavailable = (reason: string) => ({
  error: `the answer tier is unavailable on this node: ${reason}`,
  code: "answer_unavailable"
});
/** What a store online only for its owner's agents answers (XC-069): stable, so buyers' agents can rely on it. */
const NOTHING_FOR_SALE = { error: "nothing is for sale here yet", code: "nothing_for_sale" };
/** What a store that sells only by card answers when an agent tries to pay it directly. */
const CARDS_ONLY = { error: "this store takes card payments only; buy a piece from its page", code: "cards_only" };
const DISCOVER =
  "Return this node's full catalog of owner-approved publications: " +
  "teasers grouped by topic, with ids, freshness, and price. Free. " +
  "Choose zero, one, multiple, or all ids; call get once per chosen id.";
const GET =
  "Fetch one owner-approved publication by its id from the discover catalog. " +
  "Each call buys exactly one publication. Damaged ids are rejected before " +
  "payment, and an id that is no longer for sale returns an error and is never charged.";
const ANSWER =
  "Buy a response from the owner's authorized AI proxy, grounded in the " +
  "owner's approved publications. Payment settles at submission and returns a ticket " +
  "immediately; poll result until it completes. Questions are retained and " +
  "visible to the owner. Unsupported questions are refused after payment. " +
  "Refunds are not automatic: a refused or failed answer is marked owed back to " +
  "your paying address, and the owner refunds it.";
const RESULT =
  "Fetch the outcome of a paid answer ticket. Free and idempotent; keep " +
  "polling while status is running. Terminal statuses: complete, refused " +
  "(no coverage), failed (agent error or timeout). Refused and failed answers are " +
  "marked owed back; the owner refunds them.";
const publicId = {
  id: z.string().trim().refine(validPublicId, {
    message: "invalid publication id; run discover again"
  })
};
const question = {
  question: z.string().trim().min(1).max(4000)
};
/** The catalog of a store with nothing for sale. */
const EMPTY: Catalog = { manifest_version: 1, publication_count: 0, topics: {} };
/** The pieces a buyer may see: none while the owner has the store online only for their agents. */
const catalogOf = async (env: Env, settings: AnswerSettings): Promise<Catalog> => (settings.selling ? manifest(env) : EMPTY);
const ATTRIBUTION = "Content is owner-approved; preserve attribution when synthesizing.";

function asText(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    isError: isError || undefined
  };
}

export class LorePaidMCP extends McpAgent<Env> {
  // Agents pay a wallet; a store with none (card-only, or online only for agents) is never wrapped for it.
  private readonly paid = takesAgentPayments(this.env)
    ? withX402(new McpServer({ name: `Lore x402 (${networkLabel(this.env)})`, version: "0.1.0" }), {
        network: network(this.env),
        recipient: payTo(this.env),
        facilitator: facilitator(this.env)
      })
    : null;
  server = this.paid ?? new McpServer({ name: "Lore", version: "0.1.0" });

  async runAnswerTicket(payload: { ticketId: string }) {
    await this.keepAliveWhile(() => runAnswer(this.env, payload.ticketId));
  }

  async init() {
    await ensureAnswerSchema(this.env.LORE_DB);
    await ensureSalesSchema(this.env.LORE_DB);
    await ensureRefundTracking(this.env.LORE_DB);
    this.registerResult();
    const settings = await readAnswerSettings(this.env.LORE_DB);
    if (!settings.selling) this.sellNothing();
    else if (this.paid) this.sell(this.paid, settings);
    else this.sellByCardOnly(settings);
  }

  /** Selling, with no wallet for agents to pay: the catalog is the same, and each piece is bought on its page. */
  private sellByCardOnly(settings: AnswerSettings) {
    this.server.registerTool("discover", { description: DISCOVER, inputSchema: {} }, async () =>
      withSpan("lore.discover", async (setAttributes) => {
        setAttributes(() => toolSpanAttributes({ tool: "discover", outcome: "ok" }));
        return asText({
          ...(await manifest(this.env)),
          price_usd: priceOf(settings),
          listed: settings.listedName !== "",
          for_sale: true,
          ...(settings.listedName ? { name: settings.listedName } : {}),
          disclosure: "This store takes card payments only: each piece is bought on its page, at /p/<id>."
        });
      })
    );
    this.server.registerTool("get", { description: GET, inputSchema: publicId }, async () => this.refuse("get", CARDS_ONLY));
    this.server.registerTool("answer", { description: ANSWER, inputSchema: question }, async () => this.refuse("answer", CARDS_ONLY));
  }

  /** XC-069: online for the owner's own agents, with nothing for sale. The tools stay the same four, so a buyer's
   * agent sees a store like any other, with an empty catalog and a plain refusal to sell. */
  private sellNothing() {
    this.server.registerTool("discover", { description: DISCOVER, inputSchema: {} }, async () =>
      withSpan("lore.discover", async (setAttributes) => {
        setAttributes(() => toolSpanAttributes({ tool: "discover", outcome: "ok" }));
        return asText({ ...EMPTY, for_sale: false, disclosure: "Nothing is for sale here yet." });
      })
    );
    this.server.registerTool("get", { description: GET, inputSchema: publicId }, async () => this.refuse("get", NOTHING_FOR_SALE));
    this.server.registerTool("answer", { description: ANSWER, inputSchema: question }, async () => this.refuse("answer", NOTHING_FOR_SALE));
  }

  private refuse(tool: "get" | "answer", why: typeof NOTHING_FOR_SALE) {
    return withSpan(`lore.${tool}`, (setAttributes) => {
      setAttributes(() => toolSpanAttributes({ tool, outcome: "disabled" }));
      return asText(why, true);
    });
  }

  private sell(paid: NonNullable<LorePaidMCP["paid"]>, settings: AnswerSettings) {
    // MON-017: enabled settings are not enough. Without the selected provider's key the job would
    // fail after the buyer had paid, so `answer` is neither advertised nor charged for until it can run.
    const readiness = settings.enabled ? answerReadiness(this.env) : undefined;
    const answering = readiness?.ready === true;
    this.server.registerTool(
      "discover",
      {
        description: DISCOVER,
        inputSchema: {}
      },
      async () =>
        withSpan("lore.discover", async (setAttributes) => {
          setAttributes(() => toolSpanAttributes({ tool: "discover", outcome: "ok" }));
          return asText({
            ...(await manifest(this.env)),
            network: network(this.env),
            payout: payTo(this.env),
            price_usd: priceOf(settings),
            listed: settings.listedName !== "",
            for_sale: true,
            ...(settings.freeCopies ? { free_copies: settings.freeCopies } : {}),
            ...(settings.listedName ? { name: settings.listedName } : {}),
            ...(answering
              ? {
                  answer_price_usd: settings.priceUsd,
                  answer_retention_disclosure: RETENTION_DISCLOSURE
                }
              : {}),
            disclosure:
              "Choose any advertised ids; get buys one publication per call." +
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
    const get = paid.paidTool(
      "get",
      GET,
      priceOf(settings),
      publicId,
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

    if (answering) {
      const answer = paid.paidTool(
        "answer",
        ANSWER,
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
        { description: ANSWER, inputSchema: question },
        async () =>
          withSpan("lore.answer", (setAttributes) => {
            setAttributes(() => toolSpanAttributes({ tool: "answer", outcome: "disabled" }));
            return asText(readiness?.ready === false ? answerUnavailable(readiness.reason) : ANSWER_DISABLED, true);
          })
      );
    }
  }

  private registerResult() {
    this.server.registerTool(
      "result",
      {
        description: RESULT,
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

type Settled = Paid & { id: string; title: string; copy: Copy | null };

/** A payment checkout confirms into this store's account, for this piece in this store, and what it
 * bought: the piece as it stands, or nothing if it has since been taken down. */
async function settled(env: Env, account: string, session: string, id: string, origin: string, found?: Piece): Promise<Settled | null> {
  const paid = SESSION.test(session) && STRIPE_ACCOUNT.test(account) ? await paidFor(env, account, session, { id }, origin) : null;
  if (!paid) return null;
  const current = found
    ? await env.LORE_DB.prepare("SELECT title, content FROM publications WHERE public_id = ?1").bind(id).first<{ title: string; content: string }>()
    : null;
  const copy = found && current ? { piece_id: id, teaser: found.teaser, kind: found.kind, updated_at: found.updated_at, ...current } : null;
  return { ...paid, id, title: copy?.title ?? found?.teaser ?? "A piece since taken down", copy };
}

/** Keep the copy and count the sale together, once each; a payment with nothing left to keep is owed back. */
async function keep(env: Env, session: string, sale: Settled): Promise<void> {
  const db = env.LORE_DB;
  await Promise.all([ensureReceiptSchema(db), ensureRefundColumn(db)]);
  await db.batch([
    ...(sale.copy ? [keepCopy(db, session, sale.copy)] : []),
    cardSale(db, { item: sale.id, title: sale.title, priceUsd: sale.priceUsd, tx: sale.tx, refundOwed: !sale.copy })
  ]);
}

async function receiptPage(env: Env, store: Store, account: string, session: string, id: string, found: Piece | undefined): Promise<Response> {
  // A kept copy opens whatever happened since: an edit, a takedown, or cards turned off.
  const free = FREE_LINK.test(session);
  const kept = SESSION.test(session) || free ? await keptCopy(env.LORE_DB, session, id) : null;
  const sale = kept || !found ? null : await settled(env, account, session, id, store.origin, found);
  // The buyer has paid; a bookkeeping failure must never cost them the piece.
  if (sale) await keep(env, session, sale).catch(() => console.error("receiptPage(): failed to keep a paid card session"));
  const copy = kept ?? sale?.copy;
  if (copy) {
    const piece = found ?? { id, teaser: copy.teaser, kind: copy.kind, updated_at: copy.updated_at, topic: "", section: 0 };
    return html(unlockedPage(piece, store, copy, free), 200, PRIVATE);
  }
  if (!found) return html(notFound(store), 404, PRIVATE);
  const problem = free
    ? "This link doesn't open a free copy here."
    : "We couldn't find a finished card payment for this piece. If you just paid, wait a minute and reload this page.";
  return html(publicationPage(found, store, problem), 200, PRIVATE);
}

const FREE_COOKIE = /(?:^|;\s*)lore_free=(free_[0-9a-f]{32})/;

/** A reader taking a free copy, kept under a link of its own like a card receipt. A browser that
 * already took one is sent back to it instead of spending another. */
async function readFree(request: Request, env: Env, store: Store, id: string, found: Piece | undefined): Promise<Response> {
  const db = env.LORE_DB;
  await Promise.all([ensureReceiptSchema(db), ensureRefundColumn(db)]);
  const cookie = request.headers.get("cookie")?.match(FREE_COOKIE)?.[1];
  const mine = cookie && (await keptCopy(db, cookie, id)) ? cookie : null;
  const current = mine || !found
    ? null
    : await db.prepare("SELECT title, content FROM publications WHERE public_id = ?1").bind(id).first<{ title: string; content: string }>();
  const copy = found && current && { piece_id: id, teaser: found.teaser, kind: found.kind, updated_at: found.updated_at, ...current };
  const link = mine ?? (copy ? await giveCopy(db, copy, store.freeCopies ?? 0) : null);
  if (link) {
    const cookie = `lore_free=${link}; Path=/p/${id}; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`;
    return new Response(null, { status: 303, headers: { location: `/p/${id}?session_id=${link}`, "set-cookie": cookie, ...PRIVATE } });
  }
  if (!found) return html(notFound(store), 404, PRIVATE);
  return html(publicationPage(found, store, "There are no free copies of this piece left."), 200, PRIVATE);
}

function storeFor(env: Env, url: URL, settings: AnswerSettings): Store {
  return {
    name: settings.listedName,
    priceUsd: priceOf(settings),
    origin: url.origin,
    test: network(env) === TESTNET,
    freeCopies: settings.freeCopies,
    support: settings.supportEmail,
    selling: settings.selling,
    agentsPay: takesAgentPayments(env),
    ...(settings.selling && takesCards(settings) ? { checkout: env.CHECKOUT_URL } : {})
  };
}

const takesCards = (settings: AnswerSettings) => STRIPE_ACCOUNT.test(settings.stripeAccount) && priceOf(settings) >= CARD_MINIMUM_USD;
/** What a piece costs: the owner's pushed price, so a new price needs no redeploy; the deployed one until a push carries it. */
const priceOf = (settings: AnswerSettings) => settings.publicationPriceUsd || PRICE_USD;

/** Lore's checkout saying a card payment finished, so the sale counts even if the buyer never returns. The
 * notice only names a session: it is checked with checkout before anything is written. */
async function paidNotice(request: Request, env: Env, account: string, origin: string, id: string, found: Piece | undefined): Promise<Response> {
  const form = await request.formData().catch(() => null);
  const session = form?.get("session_id");
  if (typeof session !== "string") return Response.json({ recorded: false }, { status: 400, headers: PRIVATE });
  // Only the account this store takes cards into; nothing in the notice names the payee.
  const sale = await settled(env, account, session, id, origin, found);
  if (!sale) return Response.json({ recorded: false }, { status: 404, headers: PRIVATE });
  // A failed write answers 5xx, so checkout fails the webhook and Stripe sends it again.
  return keep(env, session, sale).then(
    () => Response.json({ recorded: true }, { headers: PRIVATE }),
    () => Response.json({ recorded: false }, { status: 503, headers: PRIVATE })
  );
}

/** The owner's agents' endpoint and its sign-in (XC-068), or else the buyers' `/mcp`. */
function agentOrBuyer(request: Request, url: URL, env: Env, ctx: ExecutionContext): Promise<Response> {
  const { pathname } = url;
  if (isAgentPath(pathname)) return serveAgent(request, env, ctx);
  if (pathname === "/authorize" && request.method === "GET") return signIn(url.origin).authorize(request, env);
  if (pathname === "/authorize/wait" && request.method === "POST") return signIn(url.origin).wait(request, env);
  if (pathname.startsWith("/.well-known/oauth-protected-resource/agent")) return signIn(url.origin).resource.fetch(request, env, ctx);
  if (SignIn.owns(pathname)) return signIn(url.origin).server.fetch(request, env, ctx);
  return mcp.fetch(request, env, ctx);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const page = url.pathname === "/" || /^\/p(\/|$)/.test(url.pathname);
    if (page && (request.method === "GET" || request.method === "HEAD")) {
      const settings = await readAnswerSettings(env.LORE_DB);
      const catalog = await catalogOf(env, settings);
      const store = storeFor(env, url, settings);
      const [, id, format] = url.pathname.match(/^\/p\/([0-9a-f]{24})(\.json|\/)?$/) ?? [];
      const found = pieces(catalog).find((piece) => piece.id === id);
      if (format === ".json") {
        // What Lore's checkout reads before charging: only what the page already shows, plus the payee.
        const listing = found && {
          id: found.id,
          teaser: found.teaser,
          price_usd: priceOf(settings),
          stripe_account: takesCards(settings) ? settings.stripeAccount : "",
          test: store.test
        };
        return Response.json(listing ?? { error: "not for sale here" }, { status: listing ? 200 : 404, headers: PUBLIC });
      }
      const session = url.searchParams.get("session_id");
      if (id && session !== null) {
        const response = await receiptPage(env, store, settings.stripeAccount, session, id, found);
        return request.method === "HEAD" ? html(null, response.status, PRIVATE) : response;
      }
      // Counted after the response; a buyer reopening their receipt returned above and is never a view.
      if (found && request.method === "GET") ctx.waitUntil(countView(env.LORE_DB, found.id).catch(() => undefined));
      const left = found ? await freeLeft(env.LORE_DB, found.id, settings.freeCopies) : 0;
      const body = url.pathname === "/" ? storefront(catalog, store) : found ? publicationPage(found, store, "", left) : notFound(store);
      return html(request.method === "HEAD" ? null : body, url.pathname === "/" || found ? 200 : 404, PUBLIC);
    }
    const [, posted, action] = url.pathname.match(/^\/p\/([0-9a-f]{24})\/(paid|free)$/) ?? [];
    if (posted && request.method === "POST") {
      const settings = await readAnswerSettings(env.LORE_DB);
      const catalog = await catalogOf(env, settings);
      const found = pieces(catalog).find((piece) => piece.id === posted);
      return action === "free"
        ? readFree(request, env, storeFor(env, url, settings), posted, found)
        : paidNotice(request, env, settings.stripeAccount, url.origin, posted, found);
    }
    const response = await agentOrBuyer(request, url, env, ctx);
    if (response.webSocket || response.headers.has("cache-control")) return response;
    const uncached = new Response(response.body, response);
    uncached.headers.set("cache-control", "no-store");
    return uncached;
  }
};
