// XC-100: the storefront's route and cookie rules, read straight off a path or a header. The pages they lead to
// are covered through the Worker by pages.test.ts, card.test.ts and free.test.ts.
import { describe, expect, it } from "vitest";
import { freeCookie, freeCookieHeader, pageRoute, postRoute } from "../../src/routes.js";

const ID = "0123456789abcdef01234567";
const LINK = `free_${"a".repeat(32)}`;

describe("pageRoute", () => {
  it.each([
    ["/", {}],
    ["/p", {}],
    ["/p/", {}],
    [`/p/${ID}`, { id: ID }],
    [`/p/${ID}.json`, { id: ID, format: ".json" }],
    [`/p/${ID}/`, { id: ID, format: "/" }],
    // A page path that names no id is a page all the same: a not-found one.
    [`/p/${ID.toUpperCase()}`, {}],
    [`/p/${ID.slice(1)}`, {}],
    [`/p/${ID}0`, {}],
    [`/p/${ID}/paid`, {}],
    [`/p/${ID}.html`, {}],
    ["/p/anything/at/all", {}]
  ])("%s is the page %j", (path, route) => {
    expect(pageRoute(path)).toEqual(route);
  });

  it.each(["/mcp", "/agent", "/pages", "/p.json", "", "/x/p/" + ID])("%s is not a storefront page", (path) => {
    expect(pageRoute(path)).toBeNull();
  });
});

describe("postRoute", () => {
  it.each([
    [`/p/${ID}/paid`, { id: ID, action: "paid" }],
    [`/p/${ID}/free`, { id: ID, action: "free" }],
    [`/p/${ID}/refund`, null],
    [`/p/${ID}/paid/`, null],
    [`/p/${ID}`, null],
    [`/p/${ID.toUpperCase()}/paid`, null],
    [`/p/${ID.slice(1)}/free`, null],
    ["/mcp", null]
  ])("%s names %j", (path, route) => {
    expect(postRoute(path)).toEqual(route);
  });
});

describe("freeCookie", () => {
  it.each([
    [`lore_free=${LINK}`, LINK],
    [`theme=dark; lore_free=${LINK}`, LINK],
    [`theme=dark;lore_free=${LINK}; other=1`, LINK],
    // Only a cookie named exactly lore_free, holding a well-formed link.
    [`not_lore_free=${LINK}`, undefined],
    [`lore_free=free_${"A".repeat(32)}`, undefined],
    [`lore_free=free_${"a".repeat(31)}`, undefined],
    [`lore_free=cs_test_123`, undefined],
    ["", undefined],
    [null, undefined]
  ])("%s holds %s", (header, link) => {
    expect(freeCookie(header)).toBe(link);
  });

  it("reads back the cookie it sets", () => {
    expect(freeCookie(freeCookieHeader(LINK, ID))).toBe(LINK);
  });
});

describe("freeCookieHeader", () => {
  it("keeps the link a year, for this piece's page only, out of scripts' and other sites' reach", () => {
    expect(freeCookieHeader(LINK, ID)).toBe(
      `lore_free=${LINK}; Path=/p/${ID}; Max-Age=31536000; Secure; HttpOnly; SameSite=Lax`
    );
  });
});
