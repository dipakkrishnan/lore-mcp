// XC-100: a paid answer ticket's deadline and what `result` says about it, as functions of the job and the time.
// answer-state.test.ts still covers the D1 half: expiring an overdue ticket unless a live checkpoint saves it.
import { describe, expect, it } from "vitest";
import {
  ANSWER_DISCLOSURE,
  type AnswerJob,
  DEADLINE_MS,
  ESTIMATE_SECONDS,
  RESULT_GRACE_MS,
  overdue,
  resultOf
} from "../../src/answer/ticket.js";

const CREATED = "2026-11-01T12:00:00.000Z";
const T0 = Date.parse(CREATED);
const LIMIT = DEADLINE_MS + RESULT_GRACE_MS;
const job = (overrides: Partial<AnswerJob> = {}) =>
  ({ status: "running", created_at: CREATED, answer: "", cited_publication_ids: "[]", reason: "", ...overrides }) as AnswerJob;

describe("overdue", () => {
  it("allows the agent its deadline plus a grace before calling a ticket overdue", () => {
    expect(LIMIT).toBe(240_000);
  });

  it.each([
    ["just made", "running", 0, false],
    ["past the deadline, within the grace", "running", DEADLINE_MS + 1, false],
    ["exactly at the limit", "running", LIMIT, false],
    ["a millisecond past the limit", "running", LIMIT + 1, true],
    ["a day old", "running", 86_400_000, true],
    ["complete, a day old", "complete", 86_400_000, false],
    ["refused, a day old", "refused", 86_400_000, false],
    ["failed, a day old", "failed", 86_400_000, false]
  ] as const)("a ticket %s (%s) is overdue: %s", (_, status, age, late) => {
    expect(overdue(job({ status }), T0 + age)).toBe(late);
  });

  it("never calls a ticket overdue when its start time can't be read", () => {
    expect(overdue(job({ created_at: "not a date" }), T0 + 86_400_000)).toBe(false);
  });
});

describe("resultOf", () => {
  it("a running ticket says to keep polling, with the estimate", () => {
    expect(resultOf(job())).toEqual({ status: "running", estimate_seconds: ESTIMATE_SECONDS });
  });

  it("a complete ticket gives the answer, its citations and the disclosure", () => {
    expect(resultOf(job({ status: "complete", answer: "Hire early.", cited_publication_ids: '["a","b"]' }))).toEqual({
      status: "complete",
      answer: "Hire early.",
      cited_publication_ids: ["a", "b"],
      disclosure: ANSWER_DISCLOSURE
    });
  });

  it.each([
    ["refused", "", "no coverage"],
    ["refused", "off topic", "off topic"],
    ["failed", "", "agent error"],
    ["failed", "the agent did not finish in time", "the agent did not finish in time"]
  ] as const)("a %s ticket with reason %j says %j and that refunds are manual", (status, reason, said) => {
    expect(resultOf(job({ status, reason }))).toEqual({
      status,
      reason: said,
      note: "No automated refund exists yet; contact the node owner."
    });
  });
});
