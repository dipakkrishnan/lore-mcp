import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIssue, issueBody, issueTitle } from "../src/issue";
import type { Report } from "../src/report";
import { mockGitHub } from "./github";

afterEach(() => {
  vi.restoreAllMocks();
});

function report(overrides: Partial<Report> = {}): Report {
  return {
    report_version: 1,
    title: "A title",
    email: "a@b.com",
    description: "A description",
    metadata: {
      submitted_at: "2026-01-01T00:00:00Z",
      source: "cli",
      lore_version: "0.1.0",
      platform: "Darwin 25.2.0",
      arch: "arm64",
      python_version: "3.12.4",
      install_id: "0".repeat(32)
    },
    ...overrides
  };
}

describe("issueTitle", () => {
  it("caps at 200 characters", () => {
    expect(issueTitle(report({ title: "x".repeat(250) }))).toHaveLength(200);
  });
});

describe("issueBody", () => {
  it("includes the description verbatim and every metadata row", () => {
    const body = issueBody(report({ description: "line one\n\nline two" }));
    expect(body).toContain("line one\n\nline two");
    for (const label of [
      "Source",
      "Submitted",
      "Email",
      "Lore version",
      "Platform",
      "Arch",
      "Python",
      "Install"
    ]) {
      expect(body).toContain(`| ${label} |`);
    }
  });

  it("says (not given) when there is no email", () => {
    expect(issueBody(report({ email: null }))).toContain("(not given)");
  });

  it("strips pipes, backticks, and newlines from a metadata value so the table cannot break", () => {
    const dirty = report({
      metadata: { ...report().metadata, platform: "Weird | platform\nwith `backticks`" }
    });
    const body = issueBody(dirty);
    const tableRows = body.split("\n").filter((line) => line.startsWith("| "));
    for (const row of tableRows) {
      // Exactly the field/value columns plus the leading/trailing empties
      // from String.split("|") — anything more means a cell broke the row.
      expect(row.split("|")).toHaveLength(4);
    }
  });
});

describe("createIssue", () => {
  it("sends the right headers and body, and returns the created issue", async () => {
    const { requests } = mockGitHub({ kind: "created", number: 42 });
    const issue = await createIssue(env, report());
    expect(issue.number).toBe(42);
    expect(issue.html_url).toBe("https://github.com/dipakkrishnan/lore-mcp/issues/42");
    const [request] = requests;
    expect(request.headers.get("authorization")).toBe("Bearer test-token");
    expect(request.headers.get("user-agent")).toBe("lore-feedback-relay");
    expect(request.headers.get("accept")).toBe("application/vnd.github+json");
    const body: { title: string; labels: string[] } = await request.json();
    expect(body.title).toBe("A title");
    expect(body.labels).toEqual(["feedback"]);
  });

  it("never leaks the token in a thrown error", async () => {
    mockGitHub({ kind: "unauthorized" });
    let message = "";
    try {
      await createIssue(env, report());
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toContain("test-token");
  });

  it("raises a 502 relay error on a GitHub rejection", async () => {
    mockGitHub({ kind: "validation" });
    await expect(createIssue(env, report())).rejects.toMatchObject({ status: 502 });
  });

  it("raises a 502 relay error when GitHub is unreachable", async () => {
    mockGitHub({ kind: "unreachable" });
    await expect(createIssue(env, report())).rejects.toMatchObject({ status: 502 });
  });
});
