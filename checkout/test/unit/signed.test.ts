// Stripe's webhook signature, checked against a signer written like Stripe's own. Pure: `signed`
// takes the body, the header and the secret, so this runs in plain node (XC-099); what the Worker
// does with an unsigned delivery is test/webhooks.test.ts.
import { describe, expect, it } from "vitest";
import { signed } from "../../src/webhooks";
import { ACCOUNT, PIECE, STORE } from "../stubs";

/** Must match the `STRIPE_WEBHOOK_SECRET` override in vitest.workerd.config.ts. */
const SECRET = "whsec_test_not_a_real_secret";

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
});

describe("Stripe's signature, at its edges", () => {
  it("accepts a signature exactly at the five-minute tolerance and refuses one a second past it either way", async () => {
    const body = event();
    const t = 1_800_000_000;
    const header = await signature(body, SECRET, t);
    expect(await signed(body, header, SECRET, t + 300)).toBe(true);
    expect(await signed(body, header, SECRET, t - 300)).toBe(true);
    expect(await signed(body, header, SECRET, t + 301)).toBe(false);
    expect(await signed(body, header, SECRET, t - 301)).toBe(false);
  });

  it("accepts any one valid v1 among several, as Stripe sends while a secret is rolled", async () => {
    const body = event();
    const t = Math.floor(Date.now() / 1000);
    const good = (await signature(body, SECRET, t)).split(",")[1];
    const other = (await signature(body, "whsec_old_secret", t)).split(",")[1];
    expect(await signed(body, `t=${t},${other},${good}`, SECRET)).toBe(true);
    expect(await signed(body, `t=${t},${other}`, SECRET)).toBe(false);
  });

  it("refuses a header with no timestamp, a v1 with no value, or a v1 that isn't 64 hex characters", async () => {
    const body = event();
    const t = Math.floor(Date.now() / 1000);
    const good = (await signature(body, SECRET, t)).split(",")[1];
    expect(await signed(body, good, SECRET)).toBe(false);
    expect(await signed(body, `t=${t},v1`, SECRET)).toBe(false);
    expect(await signed(body, `t=${t},${good.toUpperCase().replace("V1", "v1")}`, SECRET)).toBe(false);
    expect(await signed(body, `t=${t},${good.slice(0, -2)}`, SECRET)).toBe(false);
  });

  it("refuses a timestamp that isn't a number, even signed over what the verifier would then compute", async () => {
    const body = event();
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const overNaN = hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`NaN.${body}`)));
    expect(await signed(body, `t=soon,v1=${overNaN}`, SECRET)).toBe(false);
  });
});
