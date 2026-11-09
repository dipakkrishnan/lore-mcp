import type { AgentTool } from "@earendil-works/pi-agent-core";
import { env } from "cloudflare:workers";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { AnswerOutcome } from "../src/answer-state";
import { createAnswerTools } from "../src/answer-tools";
import { FIXTURE_PUBLICATION_ID } from "./setup";

describe("answer tools", () => {
  it("accepts only citations the agent actually read", async () => {
    let outcome: AnswerOutcome | undefined;
    const tools = createAnswerTools(env, (next) => {
      outcome = next;
    });
    const execute = async (name: string, params: Record<string, unknown>) => {
      const tool = tools.find((candidate) => candidate.name === name) as AgentTool | undefined;
      if (!tool) throw new Error(`missing tool: ${name}`);
      return await tool.execute("test", params);
    };

    const read = await execute("memory_view", { public_id: FIXTURE_PUBLICATION_ID });
    expect(read.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(read.content)).toContain("secret owner-approved content");

    const submitted = await execute("submit_answer", {
      answer: "grounded",
      cited_publication_ids: [FIXTURE_PUBLICATION_ID, new Array(24).fill("f").join("")]
    });
    expect(submitted.terminate).toBe(true);
    expect(outcome).toEqual({
      status: "complete",
      answer: "grounded",
      cited: [FIXTURE_PUBLICATION_ID]
    });
  });

  it("rejects an answer until the agent reads a cited publication", async () => {
    let outcome: AnswerOutcome | undefined;
    const submit = createAnswerTools(env, (next) => {
      outcome = next;
    }).find(({ name }) => name === "submit_answer") as AgentTool | undefined;
    if (!submit) throw new Error("missing submit_answer");
    const result = await submit.execute("test", {
      answer: "ungrounded",
      cited_publication_ids: [FIXTURE_PUBLICATION_ID]
    });
    expect(result.terminate).toBeUndefined();
    expect(JSON.stringify(result.content)).toContain("read and cite");
    expect(outcome).toBeUndefined();
  });

  it("rejects a citation revoked after it was read", async () => {
    let outcome: AnswerOutcome | undefined;
    const tools = createAnswerTools(env, (next) => {
      outcome = next;
    });
    const view = tools.find(({ name }) => name === "memory_view") as AgentTool;
    const submit = tools.find(({ name }) => name === "submit_answer") as AgentTool;
    await view.execute("test", { public_id: FIXTURE_PUBLICATION_ID });
    await env.LORE_DB.prepare("DELETE FROM publications WHERE public_id=?1")
      .bind(FIXTURE_PUBLICATION_ID)
      .run();
    const result = await submit.execute("test", {
      answer: "stale",
      cited_publication_ids: [FIXTURE_PUBLICATION_ID]
    });
    expect(result.terminate).toBeUndefined();
    expect(outcome).toBeUndefined();
  });
});

// Storage is shared across the tests in this file (the last test above deletes
// the fixture), so each test below starts by putting the fixture back.
const SECOND_PUBLICATION_ID = "1111111111111111807ae5f3";

function checksummedId(body: string) {
  return body + createHash("sha256").update(body).digest("hex").slice(0, 8);
}

function toolbox(viewed?: Set<string>) {
  const outcomes: AnswerOutcome[] = [];
  const tools = createAnswerTools(env, (next) => outcomes.push(next), viewed);
  const call = async (name: string, params: Record<string, unknown>) => {
    const tool = tools.find((candidate) => candidate.name === name) as AgentTool | undefined;
    if (!tool) throw new Error(`missing tool: ${name}`);
    const result = await tool.execute("test", params);
    const [first] = result.content;
    return { text: first.type === "text" ? first.text : "", terminate: result.terminate };
  };
  return { call, outcomes };
}

async function insertPublication(id: string, fields: { title: string; content?: string }) {
  await env.LORE_DB.prepare(
    "INSERT INTO publications (public_id, title, content, kind, topic) VALUES (?1, ?2, ?3, 'note', 'zoo')"
  )
    .bind(id, fields.title, fields.content ?? "")
    .run();
}

async function deletePublications(ids: string[]) {
  for (const id of ids) {
    await env.LORE_DB.prepare("DELETE FROM publications WHERE public_id = ?1").bind(id).run();
  }
}

describe("answer tools, one at a time", () => {
  beforeEach(async () => {
    await env.LORE_DB.prepare(
      `INSERT OR IGNORE INTO publications
         (public_id, title, content, kind, topic, teaser, sample, useful_if, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
    )
      .bind(
        FIXTURE_PUBLICATION_ID,
        "Fixture Publication",
        "the secret owner-approved content — never on the free surface",
        "note",
        "testing",
        "a teaser that is safe to advertise",
        "a free sample the owner approved",
        "you are testing the free surface",
        "2026-01-01T00:00:00Z"
      )
      .run();
  });

  describe("memory_view", () => {
    it("refuses a malformed id or a wrong checksum without marking it read", async () => {
      const viewed = new Set<string>();
      const { call } = toolbox(viewed);
      const wrongChecksum = `${FIXTURE_PUBLICATION_ID.slice(0, 23)}0`;
      expect(wrongChecksum).not.toBe(FIXTURE_PUBLICATION_ID);
      expect((await call("memory_view", { public_id: "not-an-id" })).text).toBe(
        "invalid publication id"
      );
      expect((await call("memory_view", { public_id: wrongChecksum })).text).toBe(
        "invalid publication id"
      );
      expect([...viewed]).toEqual([]);
    });

    it("says a well-formed id it cannot find is not found, and does not mark it read", async () => {
      const viewed = new Set<string>();
      const { call } = toolbox(viewed);
      const absent = checksummedId("2222222222222222");
      const result = await call("memory_view", { public_id: absent });
      expect(JSON.parse(result.text)).toEqual({ error: "publication not found" });
      expect([...viewed]).toEqual([]);
    });

    it("returns the id, title, content, topic and kind of a known piece, and marks it read", async () => {
      const viewed = new Set<string>();
      const { call } = toolbox(viewed);
      const result = await call("memory_view", { public_id: FIXTURE_PUBLICATION_ID });
      expect(JSON.parse(result.text)).toEqual({
        id: FIXTURE_PUBLICATION_ID,
        title: "Fixture Publication",
        content: "the secret owner-approved content — never on the free surface",
        topic: "testing",
        kind: "note"
      });
      expect(result.terminate).toBeUndefined();
      expect([...viewed]).toEqual([FIXTURE_PUBLICATION_ID]);
    });
  });

  describe("memory_search", () => {
    const search = async (query: string) => {
      const { text } = await toolbox().call("memory_search", { query });
      return JSON.parse(text) as Record<string, string>[];
    };

    it("finds a piece by its title, teaser, content or topic, and returns no content", async () => {
      for (const word of ["Publication", "advertise", "owner-approved"]) {
        expect(await search(word)).toEqual([
          {
            id: FIXTURE_PUBLICATION_ID,
            title: "Fixture Publication",
            teaser: "a teaser that is safe to advertise",
            topic: "testing"
          }
        ]);
      }
      const byTopic = await search("testing");
      expect(byTopic.map(({ id }) => id)).toEqual(
        expect.arrayContaining([FIXTURE_PUBLICATION_ID, SECOND_PUBLICATION_ID])
      );
      for (const row of byTopic)
        expect(Object.keys(row).sort()).toEqual(["id", "teaser", "title", "topic"]);
    });

    it("returns an empty list when nothing matches", async () => {
      expect(await search("quantum farming")).toEqual([]);
    });

    it("treats % and _ in the query as plain spaces, not wildcards", async () => {
      expect((await search("Fixture")).length).toBeGreaterThan(0);
      expect(await search("Fix%Publication")).toEqual([]);
      expect(await search("Fixtur_")).toEqual([]);
    });

    it("returns at most eight pieces", async () => {
      const ids = Array.from({ length: 10 }, (_, index) =>
        checksummedId(`33333333333333${String(index).padStart(2, "0")}`)
      );
      try {
        for (const id of ids) await insertPublication(id, { title: `zebra ${id}` });
        expect(await search("zebra")).toHaveLength(8);
      } finally {
        await deletePublications(ids);
      }
    });

    it("does not count a piece found by search as read", async () => {
      const { call, outcomes } = toolbox();
      expect(await call("memory_search", { query: "Publication" })).toMatchObject({
        terminate: undefined
      });
      const submitted = await call("submit_answer", {
        answer: "from the search results alone",
        cited_publication_ids: [FIXTURE_PUBLICATION_ID]
      });
      expect(submitted.text).toBe("read and cite at least one publication before submitting");
      expect(outcomes).toEqual([]);
    });
  });

  describe("submit_answer", () => {
    it("cites a piece once however often it is listed", async () => {
      const { call, outcomes } = toolbox();
      await call("memory_view", { public_id: FIXTURE_PUBLICATION_ID });
      const submitted = await call("submit_answer", {
        answer: "grounded",
        cited_publication_ids: [FIXTURE_PUBLICATION_ID, FIXTURE_PUBLICATION_ID]
      });
      expect(submitted).toEqual({ text: "answer accepted", terminate: true });
      expect(outcomes).toEqual([
        { status: "complete", answer: "grounded", cited: [FIXTURE_PUBLICATION_ID] }
      ]);
    });

    it("accepts pieces read before a checkpoint, passed in by the caller", async () => {
      const { call, outcomes } = toolbox(new Set([FIXTURE_PUBLICATION_ID, SECOND_PUBLICATION_ID]));
      await call("submit_answer", {
        answer: "resumed",
        cited_publication_ids: [SECOND_PUBLICATION_ID, FIXTURE_PUBLICATION_ID]
      });
      expect(outcomes).toEqual([
        {
          status: "complete",
          answer: "resumed",
          cited: [SECOND_PUBLICATION_ID, FIXTURE_PUBLICATION_ID]
        }
      ]);
    });

    it("never cites a malformed id, even one stored and marked read", async () => {
      const malformed = "f".repeat(24);
      const { call, outcomes } = toolbox(new Set([malformed]));
      try {
        await insertPublication(malformed, { title: "malformed" });
        const submitted = await call("submit_answer", {
          answer: "cites a bad id",
          cited_publication_ids: [malformed]
        });
        expect(submitted.terminate).toBeUndefined();
        expect(outcomes).toEqual([]);
      } finally {
        await deletePublications([malformed]);
      }
    });
  });

  describe("refuse", () => {
    it("ends the turn with the reason given", async () => {
      const { call, outcomes } = toolbox();
      expect(await call("refuse", { reason: "not covered" })).toEqual({
        text: "refusal accepted",
        terminate: true
      });
      expect(outcomes).toEqual([{ status: "refused", reason: "not covered" }]);
    });
  });
});
