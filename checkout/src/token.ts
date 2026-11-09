/**
 * Proof that a caller is the seller this Worker opened an account for. Only the
 * desktop app that asked for the account gets it, so an account id read off a
 * store page can't be used to open that seller's Stripe form. Keyed on its own
 * secret (ACCOUNT_TOKEN_SECRET) so a Stripe key can be rolled without logging
 * sellers out. Pure WebCrypto, so test/unit/token.test.ts runs it in plain node (XC-102).
 */
import { ACCOUNT } from "./store.js";

async function signer(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

/** The account's token: HMAC-SHA256 of the account id under `secret`, as 64 lowercase hex digits. */
export async function token(secret: string, account: string): Promise<string> {
  return hex(await crypto.subtle.sign("HMAC", await signer(secret), new TextEncoder().encode(account)));
}

/** Whether `given` is this account's token; a malformed account or token is no, without checking. */
export async function owns(secret: string, account: string, given: string): Promise<boolean> {
  if (!ACCOUNT.test(account) || !/^[0-9a-f]{64}$/.test(given)) return false;
  const bytes = new Uint8Array(given.match(/../g)!.map((pair) => parseInt(pair, 16)));
  return crypto.subtle.verify("HMAC", await signer(secret), bytes, new TextEncoder().encode(account));
}
