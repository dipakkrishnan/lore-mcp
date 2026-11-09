// XC-100: what the owner's agents may `store`, checked against the schema itself instead of through MCP.
// agent.test.ts still covers the tools as registered on `/agent`.
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Save, chars, key } from "../../src/agent-schema.js";

const memory = { title: "Hire early", content: "Managers before ten engineers." };
const issue = (result: { success: boolean; error?: { issues: { message: string }[] } }) => result.error?.issues[0]?.message;

describe("chars", () => {
  const title = chars("title", 1, 5);

  it.each([
    ["a", true],
    ["hello", true],
    ["", false],
    ["hello!", false],
    // Code points, as a person counts them: five emoji fit in five, though they are ten UTF-16 units.
    ["😀😀😀😀😀", true],
    ["😀😀😀😀😀😀", false],
    ["é".normalize("NFD").repeat(3), false]
  ])("%j fits 1–5: %s", (value, fits) => {
    expect(title.safeParse(value).success).toBe(fits);
  });

  it("names the field and the bounds, with thousands separated", () => {
    expect(issue(chars("content", 1, 20_000).safeParse(""))).toBe("content must be 1–20,000 characters");
  });

  it("says only the most when nothing is the least", () => {
    expect(issue(chars("topic", 0, 80).safeParse("x".repeat(81)))).toBe("topic must be at most 80 characters");
    expect(chars("topic", 0, 80).safeParse("").success).toBe(true);
  });

  it("counts after the base schema's own transform", () => {
    expect(chars("key", 1, 3, z.string().trim()).safeParse("  abc  ").success).toBe(true);
  });
});

describe("key", () => {
  it.each([
    ["k", "k"],
    ["  spaced  ", "spaced"],
    ["x".repeat(120), "x".repeat(120)]
  ])("%j is the key %j", (value, parsed) => {
    expect(key.parse(value)).toBe(parsed);
  });

  it.each(["", "   ", "x".repeat(121)])("%j is no key", (value) => {
    expect(key.safeParse(value).success).toBe(false);
  });
});

describe("Save", () => {
  it("takes a title and content alone", () => {
    expect(Save.parse(memory)).toEqual(memory);
  });

  it("takes every optional field, and null for each", () => {
    const full = { ...memory, topic: "hiring", kind: "lesson", key: "hiring/managers", occurred_at: "2026-08-01T09:30:00Z" };
    expect(Save.parse(full)).toEqual(full);
    const nulls = { ...memory, topic: null, kind: null, key: null, occurred_at: null };
    expect(Save.parse(nulls)).toEqual(nulls);
  });

  it.each([
    ["no title", { content: memory.content }],
    ["an empty title", { ...memory, title: "" }],
    ["a title over 200", { ...memory, title: "x".repeat(201) }],
    ["content over 20,000", { ...memory, content: "x".repeat(20_001) }],
    ["a topic over 80", { ...memory, topic: "x".repeat(81) }],
    ["an unknown kind", { ...memory, kind: "opinion" }],
    ["a blank key", { ...memory, key: "  " }]
  ])("refuses %s", (_, item) => {
    expect(Save.safeParse(item).success).toBe(false);
  });

  it.each([
    ["2026-08-01", true],
    ["2026-08-01T09:30", true],
    ["2026-08-01T09:30:15.250+02:00", true],
    ["2026-08-01T09:30:15Z", true],
    ["August 1, 2026", false],
    ["2026-8-1", false],
    ["2026-08-01 09:30", false]
  ])("occurred_at %j is an ISO 8601 date: %s", (occurred_at, valid) => {
    const result = Save.safeParse({ ...memory, occurred_at });
    expect(result.success).toBe(valid);
    if (!valid) expect(issue(result)).toBe("occurred_at must be an ISO 8601 date");
  });
});
