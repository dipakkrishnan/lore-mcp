# Telemetry

Lore had no instrumentation anywhere before `XC-030`/`MON-020`: no metrics,
traces, logs, error reporting, or analytics. This document is the plan for
adding just enough, top-down from the questions that matter and bottom-up
from what can be collected without compromising the privacy boundary the rest
of the product is built on. The backlog items in the table at the bottom are
the work; this is the why and the contracts, in the spirit of
`docs/desktop-app.md`.

## Scope and stance

Three planes, three different trust boundaries:

| Plane | What it is | Where the data goes | Consent |
|---|---|---|---|
| **Node (owner)** | The deployed x402 Worker, `lore/node/` | The owner's own Cloudflare account, via Workers' built-in observability. Never the maintainers'. | None needed — it is the owner's own infrastructure, same as any other Cloudflare Worker they run. |
| **Desktop (funnel)** | The Electron app's activation milestones | A maintainer-run collector Worker, `collector/` (not yet built — `XC-029`) | **Opt-out, on by default**, disclosed in Settings and at first launch, with an off switch (`CLI-004`). |
| **QA node (maintainer)** | The standing `lore-qa` deployment, `MON-008` | The same maintainer collector, over OTLP | N/A — maintainer-owned infrastructure and synthetic fixture data only. |

`PRIVACY.md` is rewritten alongside this document to describe the desktop
funnel honestly: on by default, a small allowlisted set of milestone events,
no content, and an off switch. A deployed node's own observability is not
"Lore telemetry" in the sense PRIVACY.md discusses — it is the owner's own
Cloudflare account, exactly like any other Worker they operate.

## Top-down: the metric tree

North star: **owners who reach a paid sale.** Every event below exists because
a row in this table needed it — nothing is collected "just in case."

| Question | Metric | Plane | Supplied by |
|---|---|---|---|
| Do installs reach first value? | Funnel conversion across setup → capture → publish → store | desktop | `app.opened`, `signin.completed`, `setup.completed`, `memory.saved`, `publication.approved`, `store.opened`, `sale.viewed` |
| Do people come back? | Distinct days with an `app.opened` per install | desktop | `app.opened` |
| Which operations fail for real users? | Failure rate by CLI command | desktop | `cli.failed` with a coded command + outcome |
| Is a deployed node serving? | Request rate, error rate, p50/p95 latency by tool | node (owner) | Workers' automatic request tracing, `observability.traces` in `wrangler.jsonc` |
| Are buyers hitting revoked or stale ids? | `get` miss rate | node (owner) | `lore.get` span, `lore.outcome = "not_found"` — the drift signal `MON-013` wants |
| Does the paid path complete? | Verified vs. settled vs. billed-but-unrecorded | node (owner) | `lore.sale` span, `lore.settled` / `lore.outcome` |
| Are answers profitable? | Cost, tokens, duration per answer job | node (owner) | `lore.answer.job` span, promoting the existing `AnswerTelemetry` |
| Did the QA deploy actually take? | Version served + latency after each merge | node (QA) | QA traces exported over OTLP to the collector (`MON-021`) |

Reading the tree top-down is what keeps the event list short. Anything not in
this table should not become a new event without first adding the question it
answers.

## Bottom-up: OpenTelemetry, honestly scoped

- **Node plane — OTel-native, zero dependencies.** Cloudflare Workers has
  first-class OpenTelemetry support: `observability.traces` / `.logs` in
  `wrangler.jsonc`, with an optional OTLP `destinations` entry configured in
  the account dashboard (so no credential ever needs to enter the repo).
  Custom spans come from `import { tracing } from "cloudflare:workers"` — a
  runtime built-in, not a package. **Implemented in this change**: `discover`,
  `get`, `answer`, and `result` each wrap their handler in a span
  (`lore.discover`, `lore.get`, `lore.answer`, `lore.result`); settlement is a
  nested `lore.sale` span inside `sales.ts`'s existing `recorded()` wrapper;
  and `answer.ts`'s background job wraps in `lore.answer.job`, promoting the
  `AnswerTelemetry` the answer tier already computes and persists to D1.
- **Desktop plane (not yet built — `APP-058`/`XC-029`/`CLI-004`) — the OTel
  data model and OTLP wire format, not the SDK.** The Python package has
  exactly two runtime dependencies (`pydantic`, `windup`); the OTel Python SDK
  is not a proportionate addition, and the Electron renderer cannot make
  network calls at all (`connect-src 'none'` in `app/desktop/src/index.html`).
  The plan is for the Electron **main** process to emit OTLP/HTTP+JSON log
  records with an `event.name` attribute — the current OTel spelling for a
  discrete event — using Electron's own `net.request`, no dependency added.
- **The collector (not yet built — `XC-029`).** A maintainer-owned Worker,
  sibling to `bridge/` and `site/`, accepting OTLP/HTTP+JSON and
  **re-validating every record against the same allowlist server-side**
  before writing to Workers Analytics Engine. Server-side validation is the
  point: an old or tampered client cannot widen the schema. The QA node's
  traces point here too (`MON-021`); owner nodes never do.

## The attribute allowlist (implemented)

`lore/node/src/telemetry.ts` is the enforcement point, not just the
convention — it generalizes the `JOB_SUMMARIES` precedent in `lore/store.py`
(a closed vocabulary of codes, never prose, never anything derived from an
exception) into span attributes:

- `OUTCOMES` — the closed outcome vocabulary shared across every span kind:
  `ok`, `not_found`, `invalid_id`, `unpaid`, `disabled`, `settle_failed`,
  `model_error`, `deadline`. Not every value applies to every span, the same
  way `JOB_SUMMARIES`'s dict is shared across job kinds. `invalid_id` and
  `unpaid` are documented but not emitted by these functions: a malformed id
  is rejected by the tool's own zod schema before any handler runs, and an
  unpaid call never reaches the handler at all — `agents/x402`'s middleware
  returns the 402 challenge itself. Both states are visible only through
  Workers' automatic request tracing, confirmed empirically against a real
  `wrangler dev` instance while building this.
- `SPAN_ATTRIBUTES` — the complete set of attribute keys any span may carry.
  Adding a key here is a privacy decision, not a refactor.
- `hashId()` — SHA-256, truncated to 16 hex characters. A publication or
  ticket id becomes `lore.item_hash`, never the id itself, so repeated
  activity on the same item can be correlated without disclosing which item
  it is.
- `assertAllowedAttributes` / `assertKnownOutcome` — thrown, not silently
  dropped, the same defense-in-depth `OwnerJob`'s Pydantic validator gives the
  local job history: an attribute or outcome outside the allowlist is a bug
  to fix, not data to forward.
- The hard deny list, enforced by `lore/node/test/telemetry.test.ts`'s leak
  table: a buyer's question, a wallet address, a transaction hash, a
  publication's title or teaser, and a node URL never reach a span attribute,
  regardless of what a call site passes in.

## Privacy rules

1. **Coded values only.** Every attribute is an enum from a closed vocabulary,
   an integer, a boolean, or a hash — never a string derived from user input,
   an exception, a path, or a URL.
2. **No content.** No memory title or body, publication title or teaser,
   buyer question, prompt, or file path.
3. **No money or identity links.** No wallet address, transaction hash,
   Cloudflare account id, node URL, or email.
4. **Install id** (desktop plane) is random, generated locally, resettable,
   and derived from nothing about the machine.
5. **No shape disclosures.** A milestone is "first memory saved," never "412
   memories" — a count discloses how much someone has written.
6. **Owner node data never reaches the maintainer.** Different Cloudflare
   account, different destination, by construction — the node plane has no
   `destinations` entry pointed at maintainer infrastructure.
7. **Hard deny list on the node plane:** `sales.title` and
   `answer_jobs.question` (both hold the buyer's raw question), `payer`, and
   `tx` never become span attributes.
8. **Best-effort.** A telemetry failure never blocks a user action or a
   buyer's paid result — the existing `sales.ts` guarantee ("a bookkeeping
   failure here must never cost the buyer the result they already paid for")
   extends to the settlement span the same way.
9. **Nothing before disclosure.** On the desktop plane, the first event fires
   only after the disclosure is on screen.

## Verified end to end

Against a real `wrangler dev` instance (not just the `vitest-pool-workers`
suite), using the local Workers Observability query API
(`/cdn-cgi/local/explorer/api/local/observability/query`):

- A `discover` call produced a real `lore.discover` span with attributes
  `{"lore.tool":"discover","lore.outcome":"ok"}` — nothing else.
- Searching every recorded span's attributes for the fixture's secret content
  and its raw publication id found neither.
- A damaged id and an unpaid `get` challenge produced **no** `lore.get` span
  at all, confirming `invalid_id` and `unpaid` really are handled upstream of
  every function in `telemetry.ts`, as documented above.

## Backlog

| ID | Title | Status |
|---|---|---|
| `XC-030` | Adopt an OpenTelemetry-shaped telemetry model and restate the privacy contract | in-review (this document) |
| `MON-020` | Trace the node's paid path in the owner's own Cloudflare account | completed by this change |
| `MON-021` | Export QA node traces over OTLP and assert node health after each deploy | ready |
| `XC-029` | Stand up the OTLP collector Worker and its Analytics Engine sink | ready |
| `CLI-004` | Add `lore telemetry on/off/status` and the `telemetry_enabled` setting | ready |
| `APP-058` | Measure the alpha activation funnel | in-review, blocked on `XC-029` and `CLI-004` |

Respect the standing anti-dashboard constraint already in the backlog
(`APP-001` "do not add a second analytics store," `APP-002` "no analytics
dashboard or speculative charts," `EVAL-002` "do not add dashboards"): the
owner-facing app gains a toggle and a disclosure, not charts. Workers
Analytics Engine is the maintainers' surface only.
