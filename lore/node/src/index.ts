import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpAgent } from "agents/mcp";
import { withX402 } from "agents/x402";
import { z } from "zod";
import {
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
import { TESTNET, facilitator, network, networkLabel } from "./network.js";
import { PRICE_USD } from "./price.js";
import { type Copy, ensureReceiptSchema, keepCopy, keptCopy } from "./receipts.js";
import { cardSale, ensureRefundColumn, ensureRefundTracking, ensureSalesSchema, recorded } from "./sales.js";
import { type Piece, type Store, notFound, pieces, publicationPage, storefront, unlockedPage } from "./storefront.js";
import { toolSpanAttributes } from "./telemetry.js";
import { withSpan } from "./tracing.js";
import { countView } from "./views.js";
import { payTo } from "./wallet.js";

const ANSWER_DISABLED = { error: "the answer tier is not enabled on this node" };

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

  async init() {
    await ensureAnswerSchema(this.env.LORE_DB);
    await ensureSalesSchema(this.env.LORE_DB);
    await ensureRefundTracking(this.env.LORE_DB);
    const settings = await readAnswerSettings(this.env.LORE_DB);
    this.server.registerTool(
      "discover",
      {
        description:
          "Return this node's full catalog of owner-approved publications: " +
          "teasers grouped by topic, with ids, freshness, and price. Free. " +
          "Choose zero, one, multiple, or all ids; call get once per chosen id.",
        inputSchema: {}
      },
      async () =>
        withSpan("lore.discover", async (setAttributes) => {
          setAttributes(() => toolSpanAttributes({ tool: "discover", outcome: "ok" }));
          return asText({
            ...(await manifest(this.env)),
            network: network(this.env),
            payout: payTo(this.env),
            price_usd: PRICE_USD,
            listed: settings.listedName !== "",
            ...(settings.listedName ? { name: settings.listedName } : {}),
            ...(settings.enabled
              ? {
                  answer_price_usd: settings.priceUsd,
                  answer_retention_disclosure: RETENTION_DISCLOSURE
                }
              : {}),
            disclosure: "Choose any advertised ids; get buys one publication per call."
          });
        })
    );

    const get = this.server.paidTool(
      "get",
      "Fetch one owner-approved publication by its id from the discover catalog. " +
        "Each call buys exactly one publication. Damaged ids are rejected before " +
        "payment, and an id that is no longer for sale returns an error and is never charged.",
      PRICE_USD,
      {
        id: z.string().trim().refine(validPublicId, {
          message: "invalid publication id; run discover again"
        })
      },
      {},
      async ({ id }) =>
        withSpan("lore.get", async (setAttributes) => {
          const row = await this.env.LORE_DB.prepare(
            `SELECT public_id AS id, title, content, topic, kind, updated_at
             FROM publications WHERE public_id = ?1`
          )
            .bind(id)
            .first();
          setAttributes(() =>
            toolSpanAttributes({ tool: "get", outcome: row ? "ok" : "not_found", paid: true, itemId: id })
          );
          return asText(
            row
              ? {
                  publication: row,
                  disclosure: "Content is owner-approved; preserve attribution when synthesizing."
                }
              : { error: `publication not found: ${id}` },
            !row
          );
        })
    );
    recorded(this.env.LORE_DB, get, "publication", PRICE_USD, (payload) => {
      const { publication } = payload as { publication: { id: string; title: string } };
      return { item: publication.id, title: publication.title };
    });

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
  const kept = SESSION.test(session) ? await keptCopy(env.LORE_DB, session, id) : null;
  const sale = kept || !found ? null : await settled(env, account, session, id, store.origin, found);
  // The buyer has paid; a bookkeeping failure must never cost them the piece.
  if (sale) await keep(env, session, sale).catch(() => console.error("receiptPage(): failed to keep a paid card session"));
  const copy = kept ?? sale?.copy;
  if (copy) {
    const piece = found ?? { id, teaser: copy.teaser, kind: copy.kind, updated_at: copy.updated_at, topic: "", section: 0 };
    return html(unlockedPage(piece, store, copy), 200, PRIVATE);
  }
  if (!found) return html(notFound(store), 404, PRIVATE);
  const problem = "We couldn't find a finished card payment for this piece. If you just paid, wait a minute and reload this page.";
  return html(publicationPage(found, store, problem), 200, PRIVATE);
}

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

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const page = url.pathname === "/" || /^\/p(\/|$)/.test(url.pathname);
    if (page && (request.method === "GET" || request.method === "HEAD")) {
      const [catalog, settings] = await Promise.all([manifest(env), readAnswerSettings(env.LORE_DB)]);
      const cards = STRIPE_ACCOUNT.test(settings.stripeAccount) && PRICE_USD >= CARD_MINIMUM_USD;
      const store: Store = {
        name: settings.listedName,
        priceUsd: PRICE_USD,
        origin: url.origin,
        test: network(env) === TESTNET,
        ...(cards ? { checkout: env.CHECKOUT_URL } : {})
      };
      const [, id, format] = url.pathname.match(/^\/p\/([0-9a-f]{24})(\.json|\/)?$/) ?? [];
      const found = pieces(catalog).find((piece) => piece.id === id);
      if (format === ".json") {
        // What Lore's checkout reads before charging: only what the page already shows, plus the payee.
        const listing = found && {
          id: found.id,
          teaser: found.teaser,
          price_usd: PRICE_USD,
          stripe_account: cards ? settings.stripeAccount : "",
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
      const body = url.pathname === "/" ? storefront(catalog, store) : found ? publicationPage(found, store) : notFound(store);
      return html(request.method === "HEAD" ? null : body, url.pathname === "/" || found ? 200 : 404, PUBLIC);
    }
    const paid = url.pathname.match(/^\/p\/([0-9a-f]{24})\/paid$/)?.[1];
    if (paid && request.method === "POST") {
      const [catalog, settings] = await Promise.all([manifest(env), readAnswerSettings(env.LORE_DB)]);
      return paidNotice(request, env, settings.stripeAccount, url.origin, paid, pieces(catalog).find((piece) => piece.id === paid));
    }
    const response = await mcp.fetch(request, env, ctx);
    if (response.webSocket || response.headers.has("cache-control")) return response;
    const uncached = new Response(response.body, response);
    uncached.headers.set("cache-control", "no-store");
    return uncached;
  }
};
