import { env } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createTicket,
  ensureAnswerSchema,
  finishJob,
  newTicketId,
  ticketResult
} from "../src/answer-state";

beforeAll(async () => {
  await ensureAnswerSchema(env.LORE_DB);
});

describe("answer job state", () => {
  it("stores cost and lets only the first terminal update win", async () => {
    const ticket = await createTicket(env, "question", 0.25);
    const telemetry = {
      model: "claude-sonnet-5",
      inputTokens: 100,
      outputTokens: 20,
      costUsd: 0.004,
      toolCalls: 2,
      durationMs: 50
    };
    expect(
      await finishJob(
        env,
        ticket,
        { status: "complete", answer: "answer", cited: [] },
        telemetry
      )
    ).toBe(true);
    expect(
      await finishJob(env, ticket, { status: "failed", reason: "late" }, telemetry)
    ).toBe(false);
    expect(await ticketResult(env, ticket)).toMatchObject({ status: "complete", answer: "answer" });
    const row = await env.LORE_DB.prepare(
      "SELECT status, cost_usd FROM answer_jobs WHERE ticket_id=?1"
    )
      .bind(ticket)
      .first<{ status: string; cost_usd: number }>();
    expect(row).toEqual({ status: "complete", cost_usd: 0.004 });
  });

  it("fails stale jobs and reports unknown tickets", async () => {
    const ticket = await createTicket(env, "question", 0.25);
    await env.LORE_DB.prepare("UPDATE answer_jobs SET created_at=?2 WHERE ticket_id=?1")
      .bind(ticket, "2020-01-01T00:00:00Z")
      .run();
    expect(await ticketResult(env, ticket)).toMatchObject({ status: "failed" });
    expect(await ticketResult(env, newTicketId())).toHaveProperty("error");
  });
});
