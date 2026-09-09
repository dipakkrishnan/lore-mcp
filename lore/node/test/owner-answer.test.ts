// The owner's free trial of their own answer proxy — src/owner-auth.ts and
// LorePaidMCP.runOwnerAnswer. Entirely outside x402: no payment, no `sales`
// row, invisible on a node that never vaulted LORE_OWNER_TOKEN.
import { env, exports } from "cloudflare:workers";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ensureAnswerSchema } from "../src/answer-state";
import { ensureSalesSchema } from "../src/sales";
import { mockFacilitator } from "./facilitator";

const TOKEN = "owner-test-token-0123456789abcdef";

type Mutable = { LORE_OWNER_TOKEN?: string; ANTHROPIC_API_KEY?: string };
const mutable = env as unknown as Mutable;
const realKey = mutable.ANTHROPIC_API_KEY;

beforeAll(async () => {
  await ensureAnswerSchema(env.LORE_DB);
  await ensureSalesSchema(env.LORE_DB);
});

afterAll(() => {
  delete mutable.LORE_OWNER_TOKEN;
  mutable.ANTHROPIC_API_KEY = realKey;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  const request = new Request("https://worker.test/owner/answer", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body)
  });
  return exports.default.fetch(request);
}

async function sales(): Promise<number> {
  const row = await env.LORE_DB.prepare("SELECT COUNT(*) AS n FROM sales").first<{ n: number }>();
  return row?.n ?? 0;
}

describe("POST /owner/answer", () => {
  it("is invisible on a node that never vaulted LORE_OWNER_TOKEN", async () => {
    delete mutable.LORE_OWNER_TOKEN;
    const response = await post({ question: "anything" }, { authorization: "Bearer nope" });
    expect(response.status).toBe(404);
  });

  it("refuses a wrong or absent bearer token once a real one is configured", async () => {
    mutable.LORE_OWNER_TOKEN = TOKEN;
    const wrong = await post({ question: "anything" }, { authorization: "Bearer not-it" });
    expect(wrong.status).toBe(404);

    const missing = await post({ question: "anything" });
    expect(missing.status).toBe(404);

    // A prefix or suffix of the real token must not pass either.
    const truncated = await post({ question: "anything" }, { authorization: `Bearer ${TOKEN.slice(0, -1)}` });
    expect(truncated.status).toBe(404);
  });

  it("rejects an empty or oversized question before touching the model", async () => {
    mutable.LORE_OWNER_TOKEN = TOKEN;
    const empty = await post({ question: "  " }, { authorization: `Bearer ${TOKEN}` });
    expect(empty.status).toBe(400);

    const tooLong = await post(
      { question: "x".repeat(4001) },
      { authorization: `Bearer ${TOKEN}` }
    );
    expect(tooLong.status).toBe(400);
  });

  it("accepts the real token, tickets the question, charges nothing, and never writes a sale", async () => {
    mutable.LORE_OWNER_TOKEN = TOKEN;
    mockFacilitator();
    const before = await sales();
    const response = await post(
      { question: "what would you say about this?" },
      { authorization: `Bearer ${TOKEN}` }
    );
    expect(response.status).toBe(200);
    const payload: unknown = await response.json();
    const body = payload as { ticket: string; status: string; poll: string };
    expect(body.status).toBe("running");
    expect(body.poll).toBe("result");
    expect(body.ticket).toMatch(/^[0-9a-f]{24}$/);

    const job = await env.LORE_DB.prepare(
      "SELECT price_usd, origin FROM answer_jobs WHERE ticket_id = ?1"
    )
      .bind(body.ticket)
      .first<{ price_usd: number; origin: string }>();
    expect(job).toMatchObject({ price_usd: 0, origin: "owner" });
    expect(await sales()).toBe(before);
  });

  it("refuses when the node's model provider is not ready, and still charges nothing", async () => {
    mutable.LORE_OWNER_TOKEN = TOKEN;
    delete mutable.ANTHROPIC_API_KEY;
    mockFacilitator();
    const before = await sales();
    const response = await post(
      { question: "what would you say about this?" },
      { authorization: `Bearer ${TOKEN}` }
    );
    expect(response.status).toBe(422);
    const payload: unknown = await response.json();
    const body = payload as { error: string };
    expect(body.error).toContain("ANTHROPIC_API_KEY");
    expect(await sales()).toBe(before);
  });
});
