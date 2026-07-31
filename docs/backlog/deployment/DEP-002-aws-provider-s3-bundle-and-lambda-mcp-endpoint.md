---
id: DEP-002
title: Add the AWS provider — S3 bundle and Lambda MCP endpoint
priority: P1
effort: L
component: deployment
status: in-review
related: [DEP-001, DEP-003, MON-007, XC-007]
blockers: [DEP-001]
dependencies: ["AWS account (owner-controlled)"]
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

`DEP-001` defines the provider interface and the publication bundle, but no
provider implements it, so nothing can actually be deployed. AWS is the first of
two providers being tried in parallel, and it is the path most likely to run
Lore's existing Python MCP handler close to as-is.

## Proposed approach

Implement the `DEP-001` lifecycle against AWS, walking the sketch's steps: detect
or install the AWS CLI, sign in or create an account, set up IAM, upload the bundle
to S3, create the Lambda, register the MCP endpoint with the owner's agents, run a
test call, and record what was built.

Specifics that are requirements rather than choices, per
`docs/node-deployment.md`:

- **IAM is least-privilege.** The function role gets read on the one bundle object,
  write to its own log group, and read on the payment secret if a price is set.
  No broader S3, no `iam:*`.
- **The bucket is private.** No public read, no website hosting, encryption at rest
  on, public access explicitly blocked at the bucket.
- **The surface is exactly `POST /mcp` and `GET /health`** behind a Lambda Function
  URL. No second route, no debug endpoint.
- **The owner's root credentials are never handled by the skill.**
- **Verification asserts the negative case** — a query matching a private memory
  must return nothing, and the deployment fails if it does not.
- **The payment secret, if any, goes to Secrets Manager** — never the bundle, never
  a function environment literal.
- **Every mutating command is approved first.** The skill runs with the owner's own
  credentials — strictly broader than the role it creates — so it prints exactly
  what it is about to execute and gets approval, step by step.
- **Cost is capped under abuse, not just at idle.** A Function URL is public and
  unauthenticated; reserved concurrency bounds the worst case and a billing alarm
  reports it. Idle-cost disclosure alone is not enough.

MVP takes Function URL over API Gateway: free and ugly beats paid and pretty for a
comparison deployment. A custom domain is out of scope.

## Acceptance criteria

- [ ] The skill detects an existing AWS CLI and offers to install it, rather than
      assuming either state
- [ ] Sign-in or account creation completes without the skill handling root
      credentials
- [ ] The created IAM role grants only: read on the bundle object, write to its own
      log group, and read on the payment secret when a price is set
- [ ] The bucket blocks public access, has encryption at rest, and serves no
      website
- [ ] `POST /mcp` and `GET /health` are the only reachable routes
- [ ] Verification runs `GET /health`, MCP `initialize`, `tools/list`, `discover`,
      and `answer` against an owner-supplied query known to match
- [ ] Verification selects a query matching at least one private memory and zero
      publications locally, asserts the deployed node returns nothing for it, and
      fails the deployment otherwise
- [ ] Every mutating provider command is shown to the owner and approved before it
      executes
- [ ] The function has a small reserved-concurrency cap and a billing alarm; the
      owner is told worst-case abuse cost alongside idle cost
- [ ] The skill emits working `codex mcp add` and `claude mcp add` snippets for the
      deployed URL
- [ ] Region, bucket, object key, function name, role ARN, and endpoint URL are
      recorded locally on success
- [ ] On failure after provisioning begins, the skill reports what exists and its
      cost, and offers teardown
- [ ] The owner is told the expected idle monthly cost before anything is
      provisioned

## Notes

Transposed from Shane's 2026-07-30 paper sketch, which drew the AWS path in full;
design in `docs/node-deployment.md`. Blocked by `DEP-001`.

The sketch's "test transaction" step is two different things depending on whether a
price is set. Unpaid, it is the MCP verification above. Paid, it is a real x402
payment and belongs to `MON-007`/`MON-008` — run on Base Sepolia first, and not
skipped on the grounds that mainnet should behave the same.

With the bundle specified as a SQLite file (`DEP-001`), this path searches it with
Lore's own FTS5/BM25 code. Confirm FTS5 is actually compiled into the Lambda
runtime's `sqlite3` rather than assuming it — if it is not, this path has the same
reimplementation problem as `DEP-003` and the comparison changes shape. The paid
path on Lambda is plausible but unresolved until `XC-007`; the free path here does
not wait on it.
