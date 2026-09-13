import { ReportError } from "./report.js";
import type { Report } from "./report.js";

/** Hardcoded by requirement (XC-028): every report lands here, never a fork. */
export const REPO = "dipakkrishnan/lore-mcp";
export const LABELS = ["feedback"];

const TABLE_UNSAFE = /[|`\r\n]/g;

/** Every metadata cell is stripped of table-breaking characters and wrapped
 * in backticks. The description goes in verbatim, outside the table, so
 * nothing a reporter types can corrupt the layout. */
function cell(value: string): string {
  return `\`${value.replace(TABLE_UNSAFE, " ").trim()}\``;
}

export function issueTitle(report: Report): string {
  return report.title.slice(0, 200);
}

export function issueBody(report: Report): string {
  const rows: [string, string][] = [
    ["Source", report.metadata.source],
    ["Submitted", report.metadata.submitted_at],
    ["Email", report.email ?? "(not given)"],
    ["Lore version", report.metadata.lore_version],
    ["Platform", report.metadata.platform],
    ["Arch", report.metadata.arch],
    ["Python", report.metadata.python_version],
    ["Install", report.metadata.install_id]
  ];
  const table = [
    "| Field | Value |",
    "| --- | --- |",
    ...rows.map(([field, value]) => `| ${field} | ${cell(value)} |`)
  ].join("\n");
  return [
    report.description,
    "",
    "---",
    "",
    table,
    "",
    "<sub>Filed by the Lore feedback relay from an in-app report.</sub>"
  ].join("\n");
}

export interface CreatedIssue {
  number: number;
  html_url: string;
}

interface GitHubIssueResponse {
  number: number;
  html_url: string;
}

/** POST to the GitHub REST API using a maintainer-held fine-grained token
 * (Issues: read/write, scoped to REPO only). Owners never hold this token —
 * see feedback-relay/README.md. */
export async function createIssue(env: Env, report: Report): Promise<CreatedIssue> {
  let response: Response;
  try {
    response = await fetch(`${env.LORE_GITHUB_API}/repos/${REPO}/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.LORE_FEEDBACK_GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        // GitHub rejects requests with no User-Agent outright.
        "User-Agent": "lore-feedback-relay"
      },
      body: JSON.stringify({
        title: issueTitle(report),
        body: issueBody(report),
        labels: LABELS
      })
    });
  } catch (error) {
    console.error("could not reach GitHub", error);
    throw new ReportError(502, "could not file the issue");
  }
  if (response.status !== 201) {
    // Never echo GitHub's response body back to the client — it can carry
    // rate-limit or auth detail. Log it for the maintainer instead.
    console.error(
      `GitHub issue creation failed: ${String(response.status)} ${await response.text()}`
    );
    throw new ReportError(502, "could not file the issue");
  }
  const body: GitHubIssueResponse = await response.json();
  return { number: body.number, html_url: body.html_url };
}
