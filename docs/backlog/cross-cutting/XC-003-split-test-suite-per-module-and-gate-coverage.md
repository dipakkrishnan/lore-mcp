---
id: XC-003
title: Split the test suite into per-module files and gate coverage at 90%
priority: P2
effort: L
component: cross-cutting
status: completed
related: [STO-001, XC-002]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-29
updated: 2026-08-26
---

## Problem

The entire suite is one 472-line `tests/test_lore.py` with a single
`LoreTest(unittest.TestCase)` class holding 29 tests across all nine modules in
`lore/`. There is no way to run the tests for one module, a failure doesn't point
at an owning component, and nothing stops a new module from shipping with no
tests at all.

Coverage reflects that. Measured on `main`, `lore/` sits at 60% combined
statement+branch, and the gap is concentrated in the two largest and most
user-facing modules: `lore/cli.py` at 31% (151 of 233 statements never executed)
and `lore/mcp.py` at 41% (81 uncovered). Every command body in `cli.py` —
`import`, `search`, `review`, and their error paths — is untested, as is the
entire MCP HTTP transport. Nothing enforces a floor, so that number can drift
down silently, which matters most right now because `STO-001` and `XC-002` are
actively rewriting the store and publishing paths that `mcp.py` exposes.

## Proposed approach

1. Split `tests/test_lore.py` into one file per source module, mirroring names:
   `tests/test_paths.py`, `test_store.py`, `test_sources.py`, `test_ui.py`,
   `test_blueprint.py`, `test_automation.py`, `test_mcp.py`, `test_cli.py`.
   Move the 29 existing tests to the file that owns the code they exercise —
   several currently span modules (`test_private_data_and_terminal_output_are_protected`
   touches `store`, `ui`, and `paths`), and those get split, not duplicated.
   Lift shared setup (`_blueprint_input`, the tmpdir/`Store` fixture, stdout
   capture) into `tests/conftest.py` or `tests/helpers.py` rather than
   copy-pasting it into eight files.
2. Add `pytest`, `pytest-cov`, and `coverage` as a `dev` optional-dependency
   group in `pyproject.toml`. Tests can stay `unittest.TestCase`-based — pytest
   collects them as-is — so this is a runner change, not a rewrite.
3. Write the missing tests to clear the floor. The bulk of the work is
   `lore/cli.py` (command dispatch, argument parsing, error and exit-code paths)
   and `lore/mcp.py` (transport, auth rejection, malformed tool input);
   `ui.py` (68%) and the 85-94% modules need targeted branch tests, not new
   scaffolding.
4. Configure the gate in `pyproject.toml` under `[tool.coverage.*]`:
   `source = ["lore"]` so tests aren't counted toward the percentage,
   `branch = true`, `fail_under = 90`.

Note on "all metrics": coverage.py's `fail_under` checks one *global* combined
number, so a file at 96% statements / 70% branches hides behind it, and a
well-covered module can carry a bare one. To actually hold 90% on each metric,
the gate needs a small check over `coverage json` output asserting per-file
statement % and branch % separately. Prefer that over the bare `fail_under` —
keep `fail_under` as the cheap outer guard. coverage.py has no native
function-level metric; statements and branches are the two it reports, so those
are the two the 90% applies to.

## Acceptance criteria

- [x] `tests/test_lore.py` is gone; every module in `lore/` with meaningful
      logic has a same-named `tests/test_<module>.py`, and all 29 original
      assertions still exist somewhere (no coverage lost in the move).
- [x] Running one module's tests works in isolation: `pytest tests/test_cli.py`
      passes on its own, without depending on another test file's setup.
- [x] Every file in `lore/` is at >=90% statement coverage **and** >=90% branch
      coverage, verified per-file rather than only in the total.
- [x] A single documented command exits non-zero when either metric drops below
      90% on any file, and that command is in the README's development section.
- [x] Coverage measures `lore/` only — `tests/` is not counted toward the
      percentage.

## Notes

Baseline measured 2026-07-29 on `main` (93244bc) via
`coverage run --branch -m unittest discover -s tests`:

| Module | Stmts | Miss | Branch | BrPart | Cover |
|---|---|---|---|---|---|
| `lore/__init__.py` | 1 | 0 | 0 | 0 | 100% |
| `lore/paths.py` | 11 | 0 | 0 | 0 | 100% |
| `lore/automation.py` | 67 | 4 | 10 | 1 | 94% |
| `lore/sources.py` | 50 | 4 | 14 | 1 | 92% |
| `lore/store.py` | 95 | 10 | 22 | 6 | 86% |
| `lore/blueprint.py` | 117 | 13 | 40 | 11 | 85% |
| `lore/ui.py` | 42 | 11 | 8 | 1 | 68% |
| `lore/mcp.py` | 136 | 81 | 48 | 14 | 41% |
| `lore/cli.py` | 233 | 151 | 80 | 6 | 31% |
| **TOTAL** | **752** | **274** | **222** | **40** | **60%** |

Effort is `L` almost entirely because of step 3. The split itself is a few
hours; taking `cli.py` from 31% to 90% is the long pole and may deserve its own
follow-up item if this one runs long.

Sequencing: `STO-001` and `XC-002` are changing `store.py`, `mcp.py`, and the
CLI surface. Splitting the files is safe either way, but writing the new
`mcp.py`/`cli.py` tests before those land means rewriting them. Consider doing
steps 1-2 now and steps 3-4 once `XC-002` settles.

There is no CI in this repo (no `.github/workflows/`), so the gate as specified
here is local-only. Wiring it into GitHub Actions is worth a separate item — an
unenforced threshold decays.

**Prioritization pass 2026-08-03:** `STO-001` and `XC-002` are `completed`, so
the sequencing concern above no longer applies, and `XC-004` now exists to wire
the gate into. Promoted `in-review` → `ready` at `P2` — unblocked and concrete,
but `L` effort with no urgent trigger keeps it behind the `P1` items this pass
promoted. (Superseded moments later by the outcome below: the branch
implementing this had been in flight the whole time and lands in this same
merge, so status moves straight to `in-progress` rather than sitting at
`ready`.)

## Outcome (2026-07-31)

Implemented on top of PR #44 (`lore node deploy`), and rebased onto it again
after #45 (MON-003) landed there, so the branch covers `lore/deploy.py`,
`lore/__main__.py`, the publication approval flow, and `lore push` — none of
which existed when this item was written.

Eleven test files, one per module plus `tests/test_package.py` for the package
surface, over `tests/helpers.py` (`LoreTestCase`, `captured`, `blueprint_input`,
`automation_profile`). 211 tests, each file green on its own.

Python coverage after, measured by `tests/gate.py`:

| Module | Stmt % | Branch % | Was (2026-07-29) |
|---|---|---|---|
| `lore/__init__.py` | 100 | 100 | 100 |
| `lore/__main__.py` | 100 | 100 | 0 |
| `lore/automation.py` | 100 | 100 | 94 |
| `lore/blueprint.py` | 100 | 100 | 85 |
| `lore/cli.py` | 99.7 | 98.5 | 31 |
| `lore/deploy.py` | 100 | 100 | — |
| `lore/mcp.py` | 100 | 97.9 | 41 |
| `lore/paths.py` | 100 | 100 | 100 |
| `lore/sources.py` | 100 | 100 | 92 |
| `lore/store.py` | 100 | 100 | 86 |
| `lore/ui.py` | 100 | 100 | 68 |

The three remaining gaps are unreachable defensive branches: `cli.main`'s
trailing `return 0` and its `node` arm falling past `deploy` (the subparser is
`required=True`, so there is no other value), and `call_tool`'s fall-through past
the `answer` arm (the tool name is validated against a two-element set above it).
All three are worth keeping and none is worth faking a test for; the per-file
floor is 90%, not 100%.

Two design notes for whoever touches this next:

- The gate lives in `tests/gate.py` rather than in `fail_under`, for the reason
  the approach section gives — it checks statements and branches separately, per
  file. Verified by raising its `FLOOR` to 99.5 and confirming it flags
  `lore/mcp.py`, which is at 100% statements but 97.9% branches: the exact shape
  `fail_under` cannot see.
- `pytest` and `coverage` are a PEP 735 `dev` dependency group, which `uv run`
  includes by default, so no command grows a `--group` flag. Tests stay
  `unittest.TestCase`-based, so `python -m unittest discover -s tests` still
  works.

## The Worker, which this item did not originally scope

`lore/node/` — 151 lines of TypeScript shipped by PR #44 — had no test framework
and no `test` script. Since it deploys as part of the same product, it is now
gated too, though not on coverage:

- `tsc --noEmit`, which already existed as `npm run check` and was wired into
  nothing.
- `wrangler deploy --dry-run`, so a bundle break surfaces here rather than
  halfway through an owner's `lore node deploy`.
- Unit tests in `tests/node/`, running in workerd via
  `@cloudflare/vitest-pool-workers`: nine tests over `src/price.ts` (the
  dollars→USDC-base-units conversion, including the float-drift case that makes
  `BigInt()` throw at $2.01) and `src/wallet.ts` (the fail-closed payout guard,
  including that a 64-hex private key is never accepted as an address).

Two small source changes made that possible, both extractions rather than
rewrites: `payTo` moved out of `src/index.ts` into `src/wallet.ts`, matching the
shape `src/price.ts` already had. Importing `index.ts` drags in the whole MCP
SDK, so a guard that lives there can only be tested by standing up a Durable
Object.

`tests/node/` is deliberately its own npm package rather than a folder inside
`lore/node/`: `lore/node/package.json` ships in the wheel, and `lore node deploy`
runs `npm install` against it on the owner's machine. Adding vitest there would
put ~106 test-only packages into every owner's deploy.

The Worker's actual request path — free `discover`, 402 on unpaid `answer` — is
**still untested before deploy**; only `scripts/smoke.ts` covers it, and only
against a running node. `XC-013` owns that, with the specific tooling blocker
written down.

Still open, as this item's own notes predicted: there is no CI, so the gate is
local-only. `XC-004` owns wiring it into GitHub Actions and is unblocked by this;
it should run `tests/gate.py --require-node`.

## Rebased onto `main` after PR #44 merged (2026-08-03)

`main` had moved 22 commits past `feat/lore-node-deploy` by the time this landed
— PR #44 merged, and MCP-001, MON-006/MON-007, and personal content capture
(CAP-001) all shipped on top of it — so GitHub retargeted this PR's base to
`main` itself. Rebasing pulled in three surface changes substantial enough that
patching the old assertions would have kept them passing for the wrong reason;
each was rewritten instead:

- **The MCP tool surface replaced `answer` with `discover`/`get`.** There is no
  server-side query any more: `discover` returns the whole manifest (teasers
  grouped by topic, keyed by an opaque `public_id` with a damage-detecting
  checksum) and `get` fetches one publication by that id. `store.search_publications()`
  and `QUERY_STOPWORDS` are gone from `lore/store.py`, replaced by
  `store.manifest()` and `store.get_publication()`. `tests/test_mcp.py` and the
  publication half of `tests/test_store.py` are rewritten around that, including
  a test that `manifest()` is byte-identical across unrelated private-row churn
  (MCP-001 AC 2) and one that a damaged public id is rejected before any lookup.
- **Publications gained a `teaser` and a `public_id`.** The teaser is the whole
  free advertisement — a publication without one never renders in the manifest —
  and `_push_sql` now keys the edge database on the opaque `public_id`, never the
  local sequential id, with a full `DROP TABLE IF EXISTS` + `CREATE TABLE`
  replace so a node deployed before these columns existed converges on the
  current schema. `tests/test_cli.py`'s push tests assert the id never leaking
  and the script executing against a pre-migration table shape.
- **`lore node deploy` now refuses to run without a price set.** `lore price
  <USD>` has to happen first; `materialize()` takes the price and bakes it into
  `src/price.ts`. `tests/test_deploy.py` covers the free-vs-unpriced distinction
  (`lore price 0` is a deliberate final state, not a missing one) and the
  materialize/redeploy price round-trip.

Also new since the item's original scope: `lore/capture.py` (CAP-001's
attended-session intake, validated with Pydantic and deduplicated on content
identity so a corrected file locator updates a row instead of duplicating it),
now with its own `tests/test_capture.py` — twelve per-module files, not eleven.
Validation across the codebase moved onto Pydantic (`blueprint.py`,
`store.py`'s `PublicationInput`, `automation.py`, `capture.py`), which changed
error-message wording throughout; every `assertRaisesRegex` that pinned an old
hand-rolled message was updated to match Pydantic's actual text rather than
loosened to stop checking it.

235 tests after, per-file coverage still ≥90% on both metrics everywhere:

| Module | Stmt % | Branch % |
|---|---|---|
| `lore/blueprint.py` | 99.1 | 95.5 |
| `lore/capture.py` | 100 | 100 |
| `lore/cli.py` | 99.7 | 98.4 |
| `lore/deploy.py` | 99.1 | 97.7 |
| `lore/mcp.py` | 100 | 97.4 |
| everything else | 100 | 100 |

The Worker side is untouched by this rebase — `lore/node/src/wallet.ts` still
extracts `payTo` the same way, and `tsc`/`wrangler deploy --dry-run`/vitest all
stayed green throughout.

## Rebased onto `main` a third time — CI, lint, and MON-010 land (2026-08-03)

`main` moved four more commits: `XC-004`/`XC-012` shipped a real six-job CI
pipeline (`.github/workflows/tests.yml`) with `ruff` for Python lint/format and
`eslint` for the Worker, and `MON-010` added `lore/node/test/` — a real
request-path suite against the Worker's actual `fetch` handler (via
`exports.default.fetch` from `cloudflare:workers`), stubbing only the x402
facilitator.

Everything under `lore/` and `lore/node/` that conflicted was pure `ruff
format`/reformatting noise (confirmed by reformatting the pre-rebase copies
and diffing — zero behavioral change survived). `docs/backlog/INDEX.md` needed
a hand merge (it is derived, not conflict-resolved through git) since an
unrelated grooming pass had reshuffled most of the table; `pyproject.toml` and
`uv.lock` needed the new `ruff` extra and this branch's `pytest`/`coverage`
dev group to coexist, which they do since one is `[project.optional-dependencies]`
and the other is `[dependency-groups]`.

One real id collision, again: `main` had independently filed its own `XC-007`
while this branch's original `XC-007` (this item's Worker-testing follow-up)
was still unpushed — see that item, now `XC-013`, for the renumbering.

Worth noting for whoever picks up `XC-013`: `MON-010`'s suite gets a real
Worker `fetch` call under `@cloudflare/vitest-pool-workers` to work at all,
suggesting the `ajv`/CJS loader crash this branch hit and documented may no
longer reproduce, or may depend on *how* the entry point is invoked (through
`cloudflare:workers`' `exports`, not a bare `SELF.fetch`/direct import).
Confirmed locally: `npm test` in `lore/node/` passes 7/7 with this branch's
`wallet.ts` extraction in place. `XC-013` is not resolved by this — it is
still a distinct gap (this item's own `tests/node/` unit-tests two leaf
modules in isolation; `MON-010`'s suite is a different, complementary thing:
one component test of the whole paid path) — but the blocker `XC-013`
describes is worth re-attempting given this evidence.

Every check re-verified green after this rebase: `pytest`, `ruff check`,
`ruff format --check`, and `tests/gate.py` (`python ok`, `worker ok`), plus
`lore/node`'s own `npm run lint` and `npm test`.

## Closed out (2026-08-26, audit/implementation pass)

PR #47 merged 2026-08-04; the item's own frontmatter had stayed `in-progress`
since. Re-verified against current `main` rather than trusting the merge
alone: `uv run python tests/gate.py`'s Python side reports every file in
`lore/` at ≥97% statement/branch coverage; `tests/node/`'s own suite (the
scope this item actually owns — `price.ts`/`wallet.ts` unit tests) passes
9/9; `tsc --noEmit` and `wrangler deploy --dry-run` in `lore/node/` both pass
clean. (The gate script's own Worker check failed on first run in this
environment — a stale `node_modules` plus a sandbox-injected `NODE_OPTIONS`
preload path that doesn't exist here, both environment artifacts unrelated
to this item's code; resolved locally with `npm install` and a clean
`NODE_OPTIONS`.)

`lore/node/test/`'s newer files (`answer.test.ts`, `paid-path.test.ts`,
`mcp-contract.test.ts` — none of them this item's own `tests/node/`)
initially failed the same way with `LORE_WALLET must be a public EVM
address`; turned out to be this checkout missing the gitignored
`lore/node/.dev.vars` that `.github/workflows/tests.yml` provisions before
every CI run. Provisioning it locally (`echo "LORE_WALLET=0x0...dEaD" >
.dev.vars`, same value CI uses) and rerunning got all 7 files/27 tests
green — not a regression, just local setup.

All five acceptance criteria are met and verified. Moving `in-progress` →
`completed`.
