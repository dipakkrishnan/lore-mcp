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
import { providerReadiness, runAnswer } from "./answer.js";
import { facilitator, network, networkLabel } from "./network.js";
import { ownerAuthorized } from "./owner-auth.js";
import { PRICE_USD } from "./price.js";
import { ensureSalesSchema, recorded } from "./sales.js";
import { storefront } from "./storefront.js";
import { toolSpanAttributes } from "./telemetry.js";
import { withSpan } from "./tracing.js";
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
    const settings = await readAnswerSettings(this.env.LORE_DB);
    // Owner-approved settings are only half of it: a node whose model secret is
    // missing would take the payment and discover that inside the scheduled job,
    // after settlement and with no refund path. Resolve it here instead, so an
    // unready node neither advertises a price nor registers a paid tool.
    const readiness = providerReadiness(this.env);
    const selling = settings.enabled && readiness.ready;
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
            ...(selling
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
        "payment; use a current catalog because a just-revoked id can still be billed.",
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
      "visible to the owner. Unsupported questions are refused after payment; " +
      "there are no automated refunds.";

    if (selling) {
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
      // Enabled but unready is a different fact from switched off, and the buyer's
      // agent should be able to tell them apart without paying to find out.
      const unavailable =
        settings.enabled && !readiness.ready
          ? { error: `the answer tier is not available on this node: ${readiness.reason}` }
          : ANSWER_DISABLED;
      this.server.registerTool(
        "answer",
        { description: answerDescription, inputSchema: question },
        async () =>
          withSpan("lore.answer", (setAttributes) => {
            setAttributes(() =>
              toolSpanAttributes({ tool: "answer", outcome: settings.enabled ? "unready" : "disabled" })
            );
            return asText(unavailable, true);
          })
      );
    }

    this.server.registerTool(
      "result",
      {
        description:
          "Fetch the outcome of a paid answer ticket. Free and idempotent; keep " +
          "polling while status is running. Terminal statuses: complete, refused " +
          "(no coverage), failed (agent error or timeout — no automated refund yet).",
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

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

/** The owner's own free trial of their answer proxy — see `owner-auth.ts`.
 * Entirely outside x402 and outside the MCP `LorePaidMCP` Durable Object: no
 * payment, no `sales` row, and invisible (404) on any node that has not
 * vaulted `LORE_OWNER_TOKEN`. Runs `runAnswer` directly rather than through
 * the Durable Object RPC surface — that object's `onStart` assumes every
 * invocation is a real MCP transport request and throws otherwise, and
 * `runAnswer` itself needs nothing but `env`. `ctx.waitUntil` keeps the
 * response snappy while the run continues; `runAnswer` never throws (see its
 * own try/catch), so this never produces an unhandled rejection.
 */
async function ownerAnswer(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!ownerAuthorized(request, env)) return new Response("Not Found", { status: 404 });
  const body = await request.json().catch(() => null);
  const question = typeof (body as { question?: unknown } | null)?.question === "string"
    ? (body as { question: string }).question.trim()
    : "";
  if (!question || question.length > 4000) {
    return json({ error: "question must be 1 to 4000 characters" }, 400);
  }
  const readiness = providerReadiness(env);
  if (!readiness.ready) {
    return json({ error: `the answer tier is not available on this node: ${readiness.reason}` }, 422);
  }
  const ticket = await createTicket(env, question, 0, "owner");
  ctx.waitUntil(runAnswer(env, ticket));
  return json({ ticket, status: "running", poll: "result", estimate_seconds: ESTIMATE_SECONDS });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return new Response(storefront(await manifest(env), PRICE_USD, networkLabel(env), url.origin), {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" }
      });
    }
    if (request.method === "POST" && url.pathname === "/owner/answer") {
      return ownerAnswer(request, env, ctx);
    }
    return mcp.fetch(request, env, ctx);
  }
};
