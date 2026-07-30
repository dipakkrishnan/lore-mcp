# Initial deployment MVP

Design notes for the `lore-deploy` skill — the Deploy branch of
`docs/full-service-onboarding.md`. Transposed from a paper sketch (2026-07-30, Shane) and
reconciled against the current `main`.

## What this is

Today a Lore node is reachable only where it runs: `lore serve` over stdio for a local
agent, or `lore serve --transport http` bound to loopback. For another person's agent to
call `discover`/`answer`, the owner has to solve reachability themselves.

`lore-deploy` is a guided skill that stands up a public MCP endpoint serving **only the
owner's active publications**, on a cloud account the owner controls. It walks the whole
path — provider choice, CLI install, account, credentials, upload, function, MCP
registration, a test call, and persisting what it built.

## The shape

```
[owner] → lore-deploy → Choose cloud provider ──┬──→ AWS
                                                ├──→ Cloudflare
                                                └──→ Others (later)

AWS:  Install CLI → Sign in / create acct → Set up IAM → Upload data to S3
      → Create Lambda → Register MCP → Test transaction → Save cloud info
```

AWS and Cloudflare are being tried **in parallel** to see which one sticks, so both are
specified here at equal depth behind one provider interface. Neither is the blessed path.

Note what Cloudflare is and is not here. It is a **hosting** option, competing with
Lambda. It is *not* the Monetization Gateway — that path was closed obsolete on
2026-07-29 (`MON-001`), because payment is now enforced in-process at the MCP layer (see
`docs/monetization-mvp.md`). Payment and hosting are orthogonal in this design: any
provider, with or without a price.

## What gets deployed — and what never does

The deployed artifact is a **publication bundle**, not the library.

`STO-001` established that `publications WHERE active=1` is the only externally-readable
surface, and that private rows of every kind — memories, private synthesized claims,
uploaded content — are unreachable from MCP. Deployment must not weaken that. It
therefore exports the *already-external* surface and nothing else:

```
~/.lore/lore.db                              stays local, always
  ├── memories        (private | discarded)  ── never exported
  ├── settings                               ── only price_usd is exported
  └── publications
        └── WHERE active=1  ──── export ────►  bundle  ──►  S3 / R2  ──►  Lambda / Worker
                                                                              │
                                                                     buyer agent → /mcp
```

Per-publication, the bundle carries `id`, `title`, `content`, `kind`, `created_at`, and
`updated_at`. It **omits `provenance`** — `STO-001`'s acceptance criteria require that no
buyer-facing payload discloses provenance memory ids, and the safest way to honor that on
a remote copy is for the ids to never be in the copy. `source_changed_at` is an
owner-facing review signal and is likewise omitted.

The bundle is a **SQLite database file** containing exactly that subset — the exported
publications, their FTS index, and the price setting. That one choice buys BM25 search
parity anywhere SQLite runs: the Lambda path reuses Lore's own search code unchanged,
and the Worker path's real question becomes whether importing the file into D1 preserves
FTS5 (see Known asymmetry). Because SQLite files are not byte-stable across rebuilds,
the recorded digest is computed over a canonical serialization of the bundle's rows, not
the raw file bytes — otherwise every rebuild would read as drift.

This is the security case for the whole design: a compromised deployed node leaks only
text the owner explicitly approved for disclosure, because that is the only text present.

## The revocation problem

This is the one genuinely hard consequence, and it must be stated plainly rather than
discovered later.

`STO-001` guarantees that revoking a publication removes it from MCP retrieval
*immediately*. That guarantee holds for a locally-served node. **A deployed bundle is a
copy, and the guarantee does not survive copying** — a revoked publication stays
answerable from the cloud until the bundle is re-pushed.

The MVP handles this by making the gap short and visible, not by pretending it isn't
there:

- Revoking (or flagging) a publication — or changing `price_usd` — marks the deployment
  stale in local settings.
- `lore status` shows the drift: how many publications differ from what is deployed, and
  how long it has been.
- `lore deploy sync` re-pushes the bundle; the skill offers it immediately after any
  revocation the owner performs in the same session.
- The deployed function refuses to serve a bundle older than the owner's configured max
  age, failing closed rather than serving indefinitely stale disclosures.

The age limit exists for exactly one reason: it bounds how long a revocation can stay
answerable when the owner forgets to push. An old bundle nothing was revoked from is
harmless — but the function cannot know that, so the owner picks the bound at deploy
time. Default 7 days; configurable, including `none` for a set-and-forget free node —
and choosing `none` means a revocation takes effect only on push, which the skill says
out loud before accepting it. Fail-closed-on-stale is the load-bearing part for any
owner who keeps a bound; everything else is convenience.

## Open problem: paid answers on a deployed node

Flagged for investigation as `XC-004`; deliberately unresolved here.

`docs/monetization-mvp.md`'s gate runs in-process inside `lore serve`. A deployed node
does not run `lore serve` — it runs a handler over the bundle — so a *paid* deployed
node needs the gate running inside the cloud handler. On Lambda that is plausible: the
Python `x402`/`cdp` stack can ship with the function. On a Cloudflare Worker it cannot;
a paid Worker means a JavaScript implementation of the payment gate, which nobody has
scoped — a far larger asymmetry than search parity.

Until `XC-004` resolves, every payment-touching requirement below (FR22, the secret
provisions in FR12 and NFR3, DEP-003's secret binding) applies only where a deployed
paid path exists at all. A free deployed node is fully designed here; a paid one is not.

## Requirements

### Functional — provider selection and the interface

- **FR1** `lore-deploy` SHALL present the available providers and their prerequisites
  (account, CLI, expected cost) before the owner picks one.
- **FR2** Providers SHALL sit behind one interface with the same lifecycle
  — `preflight`, `authenticate`, `provision`, `push_bundle`, `expose`, `verify`,
  `record` — so adding a third provider needs no change to the skill's flow.
- **FR3** The skill SHALL be idempotent and resumable: re-running it against a recorded
  deployment updates in place rather than provisioning a duplicate.
- **FR4** The skill SHALL NOT proceed past `preflight` if the local library has zero
  active publications; it SHALL instead explain that the node would answer nothing and
  point at the publish flow (`XC-002`).

### Functional — the bundle

- **FR5** The export SHALL contain only `publications WHERE active=1`, plus `price_usd`.
- **FR6** The export SHALL omit `provenance` and `source_changed_at` from every
  publication.
- **FR7** The export SHALL be content-addressed by digest, recorded locally, so drift
  between local and deployed state is detectable without a network call.
- **FR8** Revoking or flagging a publication, or changing `price_usd`, SHALL mark the
  recorded deployment stale.
- **FR9** The deployed function SHALL refuse to answer from a bundle older than the
  owner's configured max age, returning an MCP error rather than stale content. The age
  is chosen at deploy time (default 7 days) and may be disabled; disabling requires the
  skill to state the revocation trade-off and get explicit confirmation.

### Functional — AWS provider

- **FR10** The skill SHALL detect an existing AWS CLI and offer to install it, rather
  than assuming either state.
- **FR11** It SHALL walk sign-in or account creation without ever handling the owner's
  root credentials itself.
- **FR12** It SHALL create a **least-privilege** IAM role for the function: read on the
  one bundle object, write to its own log group, and read the payment secret if a price
  is set. No broader S3, no `iam:*`.
- **FR13** It SHALL upload the bundle to a private S3 bucket — no public read, no website
  hosting, encryption at rest on, and public access explicitly blocked at the bucket.
- **FR14** It SHALL deploy the MCP handler as a Lambda behind a Function URL (or API
  Gateway if a custom domain is wanted), serving `POST /mcp` and `GET /health`.
- **FR15** It SHALL record region, bucket, object key, function name, role ARN, and
  endpoint URL locally on success.

### Functional — Cloudflare provider

- **FR16** The skill SHALL detect or install `wrangler` and authenticate via
  `wrangler login`, never asking for a global API key.
- **FR17** It SHALL upload the bundle to a private R2 bucket and deploy a Worker serving
  the same `POST /mcp` and `GET /health` contract as the AWS path.
- **FR18** Where the Worker runtime cannot run Lore's Python MCP handler unmodified, the
  provider SHALL implement the same MCP contract natively rather than the skill silently
  degrading behavior. Any resulting behavioral difference SHALL be reported to the owner
  at `verify` time.
- **FR19** It SHALL record account id, bucket, object key, Worker name, and route
  locally on success.

### Functional — registration and verification

- **FR20** After exposing the endpoint, the skill SHALL verify it end to end: `GET
  /health`, then MCP `initialize`, `tools/list`, `discover`, and `answer` against a query
  the owner knows should match.
- **FR21** `verify` SHALL assert the negative case too: it selects, from the local
  library, a query that matches at least one private memory and zero publications, and
  asserts the deployed node returns nothing for it — failing the deployment otherwise.
  (Without that selection rule the check is vacuous: a correct bundle contains no
  private rows to match in the first place.)
- **FR22** Where a price is set, the "test transaction" SHALL run on the test network
  first (see `docs/monetization-mvp.md`), and SHALL NOT be skipped on the grounds that
  mainnet "should work the same".
- **FR23** The skill SHALL emit the exact registration snippet for both supported agents
  (`codex mcp add` / `claude mcp add`) pointed at the deployed URL.
- **FR24** On any failure after provisioning has begun, the skill SHALL report what exists
  and what it will cost, and offer to tear it down — never leave orphaned paid resources
  undocumented.

### Functional — safeguards

- **FR25** Before executing any mutating provider command (IAM, bucket, function,
  secret), the skill SHALL show the owner exactly what will run and get approval. The
  skill operates with the owner's own cloud credentials — strictly broader than the
  least-privilege role it creates — so the audit trail is the owner approving each
  step, not trust in the agent.
- **FR26** The deployed function SHALL be capped: a small fixed concurrency bound, plus
  a billing or spend alert wherever the provider supports one. NFR4's idle-cost
  disclosure SHALL be accompanied by the worst-case cost under abuse and what bounds
  it — a public unauthenticated endpoint is an invitation to spend the owner's money.

### Non-functional / constraints

- **NFR1** No private memory, of any status, leaves the machine. This is the invariant the
  whole design exists to preserve.
- **NFR2** Cloud credentials are never written into Lore's database or its prompt files.
  The provider's own credential store (`~/.aws/credentials`, `wrangler`'s config) stays
  authoritative; Lore records only non-secret deployment metadata.
- **NFR3** The payment secret, if any, lives in the provider's secret manager (AWS Secrets
  Manager / Worker secret binding), never in the bundle, the function's environment
  literal, or the repo.
- **NFR4** Default to the smallest and cheapest resource shape that works, and tell the
  owner the expected monthly cost at idle before provisioning.
- **NFR5** The deployed surface is exactly `POST /mcp` and `GET /health`. No second route,
  no bucket-level public read, no debug endpoint.
- **NFR6** Adding a provider must not require touching AWS or Cloudflare code.

## Provider mapping

| Concern | AWS | Cloudflare |
|---|---|---|
| CLI | `aws` | `wrangler` |
| Auth | IAM user / SSO profile | `wrangler login` (OAuth) |
| Bundle storage | S3 (private, encrypted) | R2 (private) |
| Compute | Lambda + Function URL | Worker |
| Secret store | Secrets Manager | Worker secret binding |
| Logs | CloudWatch Logs | Workers Logs / tail |
| Idle cost | ~$0 (storage only) | ~$0 (within free tier) |

### Known asymmetry

The AWS path can run Lore's existing Python MCP handler close to as-is, searching the
SQLite bundle with the same FTS5/BM25 code that runs locally (confirm FTS5 is actually
compiled into the Lambda runtime's `sqlite3` rather than assuming it). The Cloudflare
Worker cannot run that code; its plausible move is importing the SQLite bundle into D1 —
which is SQLite underneath — and the open question is whether FTS5 survives the import.
If it does, search parity is nearly free on both paths; if not, the CF provider
reimplements search natively.

That asymmetry is the reason both providers are being tried rather than one being chosen
on paper: the interface in FR2 is what makes the comparison cheap, and full-text search
behavior on a small publication set is the specific thing to compare. Do not let the CF
path quietly return substring matches while the AWS path returns BM25-ranked ones — FR18
exists to force that difference into the open. The *payment* asymmetry is larger still
and is not this comparison's to resolve — see "Open problem" above and `XC-004`.

## What this intentionally does not do

- **No publication creation.** Deploy exports publications; `XC-002` creates them.
- **No payment implementation.** That is `docs/monetization-mvp.md` — and for a
  *deployed* node the paid path is an open problem (`XC-004`), not an inherited feature.
  A deployment with no price set is a free public node, and that is a valid end state.
- **No custom domain, no CDN tuning, no multi-region.** One endpoint, one region.
- **No live replication.** The bundle is a push, not a sync. See "The revocation problem".
- **No buyer identity, rate limiting, or per-buyer policy.** The README lists those as
  future work and they stay future work.
- **No syncing the local `lore.db` to the cloud in any form.**

## Open follow-ups

- The 7-day *default* for the bundle max age is still a guess, even with the bound
  owner-configurable. It trades disclosure risk against forced re-push cadence, and
  wants a real opinion.
- Whether `lore deploy` should exist as a command at all, or stay skill-only. The skill
  needs *some* local command to record and read deployment metadata; `sync`, `status`,
  and `destroy` are the plausible minimum.
- Function URL vs. API Gateway on AWS: the former is free and ugly, the latter costs and
  gives a custom domain. MVP takes Function URL.
- Whether the stale-bundle refusal should be a hard error or a degraded response carrying
  a warning. Hard error is proposed, as it is the only version that fails closed.
- Cost telemetry — the owner should learn about an unexpected bill from Lore, not from
  the provider. Out of scope here.

## Related

- `docs/full-service-onboarding.md` — the handoff this branches from
- `docs/monetization-mvp.md` — the payment gate a deployed node may carry
- Backlog: `DEP-001` (interface + bundle), `DEP-002` (AWS), `DEP-003` (Cloudflare)
- `STO-001` — publications as the only external surface
- `XC-002` — the publish flow that fills the table deployment exports
- `XC-004` — where the payment gate runs for a deployed node (open investigation)
