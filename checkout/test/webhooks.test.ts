import { exports } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signed } from "../src/webhooks";
import { ACCOUNT, PIECE, STORE, stub } from "./stubs";

/** Must match the `STRIPE_WEBHOOK_SECRET` override in vitest.config.ts. */
const SECRET = "whsec_test_not_a_real_secret";

afterEach(() => {
  vi.restoreAllMocks();
});

const hex = (buffer: ArrayBuffer) => [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** Signs like Stripe: HMAC-SHA256 of `<t>.<body>` under the endpoint secret. */
async function signature(body: string, secret = SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return `t=${timestamp},v1=${hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)))}`;
}

const event = (overrides: Record<string, unknown> = {}, session: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "checkout.session.completed",
    account: ACCOUNT,
    data: { object: { id: "cs_test_abc", payment_status: "paid", metadata: { origin: STORE, piece: PIECE }, ...session } },
    ...overrides
  });

const deliver = async (body: string, header?: string) =>
  exports.default.fetch("https://checkout.test/webhooks", {
    method: "POST",
    body,
    headers: { "stripe-signature": header ?? (await signature(body)) }
  });

const notices = (calls: { url: string; body: string }[]) => calls.filter((call) => call.url.endsWith("/paid"));

describe("Stripe's signature", () => {
  it("accepts Stripe's own signing and refuses a wrong secret, a stale timestamp, or a tampered body", async () => {
    const body = event();
    expect(await signed(body, await signature(body), SECRET)).toBe(true);
    expect(await signed(body, await signature(body, "whsec_someone_else"), SECRET)).toBe(false);
    expect(await signed(body, await signature(body, SECRET, Math.floor(Date.now() / 1000) - 600), SECRET)).toBe(false);
    expect(await signed(`${body} `, await signature(body), SECRET)).toBe(false);
    expect(await signed(body, "", SECRET)).toBe(false);
    expect(await signed(body, await signature(body), "")).toBe(false);
  });

  it("drops an unsigned delivery before telling any store", async () => {
    const calls = stub();
    const response = await deliver(event(), "t=1,v1=00");
    expect(response.status).toBe(400);
    expect(calls).toEqual([]);
  });
});

describe("a paid checkout", () => {
  it("tells the store the account is tied to, naming only the session", async () => {
    const calls = stub();
    const response = await deliver(event());
    expect(response.status).toBe(200);
    const [notice] = notices(calls);
    expect(notice.url).toBe(`${STORE}/p/${PIECE}/paid`);
    expect(Object.fromEntries(new URLSearchParams(notice.body))).toEqual({ session_id: "cs_test_abc" });
  });

  it("counts an async payment once it succeeds", async () => {
    const calls = stub();
    expect((await deliver(event({ type: "checkout.session.async_payment_succeeded" }))).status).toBe(200);
    expect(notices(calls)).toHaveLength(1);
  });

  it("tells no store about a session whose account is tied to another store", async () => {
    const calls = stub({ boundTo: "https://real-seller.test" });
    expect((await deliver(event())).status).toBe(200);
    expect(notices(calls)).toEqual([]);
  });

  it("ignores unpaid sessions and other events", async () => {
    const calls = stub();
    expect((await deliver(event({}, { payment_status: "unpaid" }))).status).toBe(200);
    expect((await deliver(event({ type: "customer.created" }))).status).toBe(200);
    expect(notices(calls)).toEqual([]);
  });

  it("asks Stripe to retry when the store can't take the sale yet", async () => {
    stub({ noticeStatus: 503 });
    expect((await deliver(event())).status).toBe(502);
  });
});
