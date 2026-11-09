// XC-102: the checks /report and /events make before filing or forwarding anything, as tables.
// What the Worker answers over HTTP for each is test/relay.test.ts and test/events.test.ts.
import { describe, expect, it } from "vitest";
import {
  EVENTS_BODY_BYTES,
  RATE_LIMITED,
  failure,
  parseJson,
  readEvents,
  refuseBody,
  refuseContentType,
  refuseDeclaredLength,
  refuseMethod
} from "../../src/report-rules";
import { LIMITS, ReportError } from "../../src/report";

const TOO_LARGE = { status: 413, error: "request body too large" };

describe("refuseMethod", () => {
  it.each([
    ["POST", null],
    ["GET", { status: 405, error: "method not allowed", headers: { Allow: "POST" } }],
    ["PUT", { status: 405, error: "method not allowed", headers: { Allow: "POST" } }],
    ["post", { status: 405, error: "method not allowed", headers: { Allow: "POST" } }]
  ])("%s → %o", (method, expected) => {
    expect(refuseMethod(method)).toEqual(expected);
  });
});

describe("RATE_LIMITED", () => {
  it("is a 429 that tells the caller to wait a minute", () => {
    expect(RATE_LIMITED).toEqual({ status: 429, error: "too many requests", headers: { "Retry-After": "60" } });
  });
});

describe("refuseContentType", () => {
  const unsupported = { status: 415, error: "Content-Type must be application/json" };
  it.each([
    ["application/json", null],
    ["application/json; charset=utf-8", null],
    ["Application/JSON", null],
    ["text/plain", unsupported],
    ["", unsupported],
    [null, unsupported]
  ])("%o → %o", (contentType, expected) => {
    expect(refuseContentType(contentType)).toEqual(expected);
  });
});

describe("the two-step body cap", () => {
  const limit = LIMITS.bodyBytes;

  it.each([
    ["absent", null, null],
    ["zero", "0", null],
    ["at the limit", String(limit), null],
    ["one past the limit", String(limit + 1), TOO_LARGE],
    // Not a number: the header can't be believed, so the bytes actually read decide.
    ["unreadable", "lots", null]
  ])("a declared length %s (%o) → %o", (_, header, expected) => {
    expect(refuseDeclaredLength(header)).toEqual(expected);
  });

  it.each([
    ["empty", "", null],
    ["at the limit", "x".repeat(limit), null],
    ["one byte past the limit", "x".repeat(limit + 1), TOO_LARGE],
    // Counted in UTF-8 bytes, not characters: half as many two-byte characters is the same size.
    ["at the limit in two-byte characters", "é".repeat(limit / 2), null],
    ["one character past the limit in two-byte characters", "é".repeat(limit / 2 + 1), TOO_LARGE]
  ])("a body %s → %o", (_, raw, expected) => {
    expect(refuseBody(raw)).toEqual(expected);
  });

  it("holds each half to the limit it is given", () => {
    expect(refuseDeclaredLength("11", 10)).toEqual(TOO_LARGE);
    expect(refuseBody("x".repeat(11), 10)).toEqual(TOO_LARGE);
    expect(refuseBody("x".repeat(10), 10)).toBeNull();
  });
});

describe("parseJson", () => {
  const notJson = { status: 400, error: "the request body is not valid JSON" };
  it.each([
    ['{"a":1}', { value: { a: 1 } }],
    ["[]", { value: [] }],
    ["null", { value: null }],
    ["", notJson],
    ["{", notJson],
    ["not json", notJson]
  ])("%o → %o", (raw, expected) => {
    expect(parseJson(raw)).toEqual(expected);
  });
});

describe("failure", () => {
  it.each([
    ["a refused report keeps its own status and reason", new ReportError(422, "title too long"), { status: 422, error: "title too long" }],
    ["a GitHub refusal passed on as a ReportError", new ReportError(503, "GitHub is down"), { status: 503, error: "GitHub is down" }],
    ["any other error is a 502 that says nothing more", new Error("secret detail"), { status: 502, error: "could not file the issue" }],
    ["so is a thrown non-error", "boom", { status: 502, error: "could not file the issue" }]
  ])("%s", (_, error, expected) => {
    expect(failure(error)).toEqual(expected);
  });
});

describe("readEvents", () => {
  const INSTALL = "0".repeat(32);
  const AT = "2026-11-09T00:00:00Z";
  const batch = (events: unknown[], overrides: Record<string, unknown> = {}) =>
    JSON.stringify({ install_id: INSTALL, version: "0.1.0", events, ...overrides });
  const names = (raw: string) => {
    const read = readEvents(raw);
    return "batch" in read ? read.batch.events.map(({ name, props }) => [name, props]) : read;
  };

  it.each([
    ["too large", "x".repeat(EVENTS_BODY_BYTES + 1), TOO_LARGE],
    ["not JSON", "{", { status: 400, error: "the request body is not valid JSON" }],
    ["not a batch", "[]", { status: 400, error: "not a usage batch" }],
    ["a bad install id", batch([], { install_id: "nope" }), { status: 400, error: "not a usage batch" }]
  ])("refuses a body that is %s", (_, raw, expected) => {
    expect(readEvents(raw)).toEqual(expected);
  });

  it("takes a body of exactly the cap", () => {
    const raw = batch([]);
    const padded = raw + " ".repeat(EVENTS_BODY_BYTES - raw.length);
    expect(readEvents(padded)).toEqual({ batch: { install_id: INSTALL, version: "0.1.0", events: [] } });
  });

  it.each([
    ["an event with no property, sent bare", { name: "app.opened", at: AT }, [["app.opened", {}]]],
    ["an event with no property, sent with one", { name: "app.opened", props: { via: "capture" }, at: AT }, []],
    ["an optional property left out", { name: "memory.saved", at: AT }, [["memory.saved", {}]]],
    ["an optional property given", { name: "memory.saved", props: { via: "capture" }, at: AT }, [["memory.saved", { via: "capture" }]]],
    ["an optional property with a value off the list", { name: "memory.saved", props: { via: "email" }, at: AT }, []],
    ["a required property left out", { name: "firstrun.step", at: AT }, []],
    ["a required property under the wrong key", { name: "firstrun.step", props: { stage: "apps" }, at: AT }, []],
    ["two properties", { name: "firstrun.step", props: { step: "apps", via: "capture" }, at: AT }, []],
    ["a name off the list", { name: "page.viewed", at: AT }, []],
    ["a malformed time", { name: "app.opened", at: "yesterday" }, []]
  ])("keeps only what is on the list: %s", (_, event, expected) => {
    expect(names(batch([event]))).toEqual(expected);
  });
});
