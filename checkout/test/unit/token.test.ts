// XC-102: the seller's account token, without the Worker. That /onboard, /accounts/bind and
// /accounts/status refuse a caller without it is test/checkout.test.ts.
import { describe, expect, it } from "vitest";
import { owns, token } from "../../src/token";
import { ACCOUNT } from "../stubs";

const SECRET = "not_a_real_token_secret";

describe("token", () => {
  it("is HMAC-SHA256 of the account id under the token secret, in lowercase hex", async () => {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(ACCOUNT)));
    const expected = [...signed].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    expect(await token(SECRET, ACCOUNT)).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs by account and by secret", async () => {
    const mine = await token(SECRET, ACCOUNT);
    expect(await token(SECRET, "acct_1SomeoneElse")).not.toBe(mine);
    expect(await token("a_rolled_secret", ACCOUNT)).not.toBe(mine);
    expect(await token(SECRET, ACCOUNT)).toBe(mine);
  });
});

describe("owns", () => {
  it.each<[string, (mine: string) => [string, string, string], boolean]>([
    ["the account's own token", (mine) => [SECRET, ACCOUNT, mine], true],
    ["another account's id with this token", (mine) => [SECRET, "acct_1SomeoneElse", mine], false],
    ["the token under a rolled secret", (mine) => ["a_rolled_secret", ACCOUNT, mine], false],
    ["a well-formed token that isn't it", () => [SECRET, ACCOUNT, "0".repeat(64)], false],
    ["the token in upper case", (mine) => [SECRET, ACCOUNT, mine.toUpperCase()], false],
    ["the token one digit short", (mine) => [SECRET, ACCOUNT, mine.slice(1)], false],
    ["the token with a digit more", (mine) => [SECRET, ACCOUNT, `${mine}0`], false],
    ["no token", () => [SECRET, ACCOUNT, ""], false],
    ["an account id that isn't one", (mine) => [SECRET, "not_an_account", mine], false],
    ["no account", (mine) => [SECRET, "", mine], false]
  ])("%s → %o", async (_, args, expected) => {
    const mine = await token(SECRET, ACCOUNT);
    expect(await owns(...args(mine))).toBe(expected);
  });

  it("checks a malformed account against nothing, even when the token is its HMAC", async () => {
    const odd = "acct_1 spaced";
    expect(await owns(SECRET, odd, await token(SECRET, odd))).toBe(false);
  });
});
