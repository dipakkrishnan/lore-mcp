import { vi } from "vitest";

/** Must match the `LORE_GITHUB_API` override in vitest.config.ts. */
export const GITHUB_API = "https://github.test";

export type GitHubReply =
  | { kind: "created"; number?: number }
  | { kind: "validation" } // 422
  | { kind: "unauthorized" } // 401
  | { kind: "server-error" } // 502
  // No response ever arrives — models a dropped connection or DNS failure.
  | { kind: "unreachable" };

/**
 * Stubs the outbound `POST /repos/.../issues` call `src/issue.ts` makes, so
 * the relay's tests run with no real network and no real GitHub token.
 * Modelled on lore/node/test/facilitator.ts: call once per test, restore
 * with `vi.restoreAllMocks()` in `afterEach`. Any other outbound fetch (a
 * wrong host, path, or method) throws instead of silently succeeding.
 */
export function mockGitHub(reply: GitHubReply = { kind: "created" }) {
  const requests: Request[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = new Request(input, init);
    // `input` here carries the incoming-request `Cf` generic from the mocked
    // global fetch signature, which the plain `Request[]` array below does
    // not — a real type mismatch (differing Cf shapes), not a redundant cast.
    requests.push(request.clone() as Request);
    const url = new URL(request.url);
    if (url.origin !== new URL(GITHUB_API).origin) {
      throw new Error(`unexpected outbound fetch during test: ${request.method} ${url}`);
    }
    if (request.method !== "POST" || url.pathname !== "/repos/dipakkrishnan/lore-mcp/issues") {
      throw new Error(`unexpected GitHub request during test: ${request.method} ${url}`);
    }
    if (reply.kind === "unreachable") {
      throw new Error("simulated GitHub outage");
    }
    if (reply.kind === "created") {
      const number = reply.number ?? 123;
      return Response.json(
        { number, html_url: `https://github.com/dipakkrishnan/lore-mcp/issues/${String(number)}` },
        { status: 201 }
      );
    }
    if (reply.kind === "validation") {
      return Response.json({ message: "Validation Failed" }, { status: 422 });
    }
    if (reply.kind === "unauthorized") {
      return Response.json({ message: "Bad credentials" }, { status: 401 });
    }
    return Response.json({ message: "Internal Server Error" }, { status: 502 });
  });
  return { spy, requests };
}
