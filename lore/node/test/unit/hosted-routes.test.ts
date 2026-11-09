// XC-100 (XC-088): which Worker a request to the hosted zone belongs to, by its host. test/hosted/hosted.test.ts
// still covers the hand-off itself: a store's Durable Object, or the zone's other Workers by binding.
import { describe, expect, it } from "vitest";
import { STORE, otherOf, storeOf } from "../../src/hosted/routes.js";

const DOMAIN = "yourlore.dev";
const STORE_NAME = "abcdefgh2345";

describe("storeOf", () => {
  it.each([
    [`${STORE_NAME}.${DOMAIN}`, STORE_NAME],
    [`${STORE_NAME}.yourlore.test`, null],
    [`${STORE_NAME}${DOMAIN}`, null],
    [DOMAIN, null],
    [`www.${DOMAIN}`, null],
    [`relay.${DOMAIN}`, null],
    // A store's address is twelve base32 characters, lower case, and nothing more.
    [`ABCDEFGH2345.${DOMAIN}`, null],
    [`abcdefgh2341.${DOMAIN}`, null],
    [`abcdefgh234.${DOMAIN}`, null],
    [`abcdefgh23456.${DOMAIN}`, null],
    [`x.${STORE_NAME}.${DOMAIN}`, null]
  ])("%s is the store %s", (host, store) => {
    expect(storeOf(host, DOMAIN)).toBe(store);
  });

  it("matches only a whole store address", () => {
    expect(STORE.test(STORE_NAME)).toBe(true);
    expect(STORE.test(`${STORE_NAME}.`)).toBe(false);
  });
});

describe("otherOf", () => {
  it.each([
    [`relay.${DOMAIN}`, "RELAY"],
    [`checkout.${DOMAIN}`, "CHECKOUT"],
    [`www.${DOMAIN}`, "SITE"],
    [`relay.example.com`, null],
    [`site.${DOMAIN}`, null],
    [`RELAY.${DOMAIN}`, null],
    [`x.relay.${DOMAIN}`, null],
    [DOMAIN, null],
    [`${STORE_NAME}.${DOMAIN}`, null],
    // Never a name off the object's prototype.
    [`constructor.${DOMAIN}`, null],
    [`__proto__.${DOMAIN}`, null],
    [`toString.${DOMAIN}`, null]
  ])("%s goes to %s", (host, binding) => {
    expect(otherOf(host, DOMAIN)).toBe(binding);
  });
});
