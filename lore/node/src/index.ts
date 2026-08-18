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
  runAnswer,
  ticketResult,
  validPublicId
} from "./answer.js";
import { facilitator, network, networkLabel } from "./network.js";
import { PRICE_USD } from "./price.js";
import { payTo } from "./wallet.js";

const ANSWER_DISABLED = { error: "the answer tier is not enabled on this node" };

function asText(payload: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload) }],
    isError: isError || undefined
  };
}

// ponytail: withX402 (which provides paidTool) only works on the legacy
// McpAgent class today; migrate when Cloudflare supports x402 on its
// recommended stateless createMcpHandler path.
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
    await runAnswer(this.env, payload.ticketId);
  }

  async init() {
    await ensureAnswerSchema(this.env.LORE_DB);
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
        asText({
          ...(await manifest(this.env)),
          network: network(this.env),
          price_usd: PRICE_USD,
          ...(settings.enabled
            ? {
                answer_price_usd: settings.priceUsd,
                answer_retention_disclosure: RETENTION_DISCLOSURE
              }
            : {}),
          disclosure: "Choose any advertised ids; get buys one publication per call."
        })
    );

    this.server.paidTool(
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
      {}, // paidTool's output schema; unstructured text only.
      async ({ id }) => {
        // Paid and free read the same rows: payment decides whether a caller
        // is served, never what is servable. One payment maps to exactly one
        // publication, chosen by the buyer from the catalog. The checksum rejects
        // damaged ids before payment; the remaining billable miss is a revocation
        // racing a recent discover, because paidTool settles before this handler.
        // ponytail: charged not-found on that race; refund or pre-check when
        // the x402 wrapper exposes a pre-settlement hook.
        const row = await this.env.LORE_DB.prepare(
          `SELECT public_id AS id, title, content, topic, kind, updated_at
           FROM publications WHERE public_id = ?1`
        )
          .bind(id)
          .first();
        return asText(
          row
            ? {
                publication: row,
                disclosure: "Content is owner-approved; preserve attribution when synthesizing."
              }
            : { error: `publication not found: ${id}` },
          !row
        );
      }
    );

    const question = {
      question: z.string().trim().min(1).max(4000)
    };
    const answerDescription =
      "Buy a synthesized answer from the owner's approved publications, in the " +
      "owner's voice. Payment settles at submission and returns a ticket " +
      "immediately; poll result until it completes. Questions are retained and " +
      "visible to the owner. Unsupported questions are refused after payment; " +
      "there are no automated refunds.";

    if (settings.enabled) {
      this.server.paidTool(
        "answer",
        answerDescription,
        settings.priceUsd,
        question,
        {},
        async (args) => {
          const ticket = await createTicket(this.env, args.question, settings.priceUsd);
          await this.schedule(0, "runAnswerTicket", { ticketId: ticket });
          return asText({
            ticket,
            status: "running",
            poll: "result",
            estimate_seconds: ESTIMATE_SECONDS,
            retention_disclosure: RETENTION_DISCLOSURE
          });
        }
      );
    } else {
      this.server.registerTool(
        "answer",
        { description: answerDescription, inputSchema: question },
        async () => asText(ANSWER_DISABLED, true)
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
      async (args) => {
        const outcome = await ticketResult(this.env, args.ticket);
        return asText(outcome, "error" in outcome);
      }
    );
  }
}

export default LorePaidMCP.serve("/mcp", { binding: "LorePaidMCP" });
