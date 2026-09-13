# Handoff: test plan for Dipak's four user stories

> **Superseded in part.** Phase 1 of this plan now exists as
> `docs/manual-test-walkthrough.md` — a runnable manual walkthrough of all four
> scenarios with a fillable rubric, plus `support/manual_test_report.py` to
> convert a filled record to JSON. Run that. What remains open here is Phase 2,
> the automation question, and the three questions below are still the ones that
> decide it.

**Status:** the automation scoping is still paused, 2026-09-07. The manual
walkthrough that came out of it instead is built and shipped.
**Branch at pause:** `app-019-desktop-price`.
**Goal:** produce a test plan covering all test levels for the four dogfood user
stories Dipak wrote (net-new user, understand a sale, browser-dependent payment
setup, switch to real payments and back).

---

## For the agent resuming this

### What the user asked for

Dipak authored four end-to-end user stories (reproduced in full below). The user
wants a testing plan spanning **all test levels** for them — unit, component,
contract, integration, end-to-end, agent/eval, accessibility, and manual — not
just an e2e checklist. The session was in the question-asking phase; one round of
questions was answered, a second round was interrupted so the user could clarify
the questions themselves. **Nothing has been produced yet.**

### Decisions already made (do not re-litigate)

| Axis | Decision |
|---|---|
| Purpose | **Both, phased.** Phase 1 = launch-readiness gate for these 4 stories (scripted manual + existing suites). Phase 2 = convert the repeatable parts into CI-enforced automation. The plan must label which phase each item belongs to. |
| Desktop UI automation | **Build a Playwright + Electron harness.** Drives the real renderer: onboarding, Memories, For Sale, attended browser cards. The user accepted the lift; this is the only path to real automated coverage for stories 1–3. |
| Real money / mainnet | **Testnet only; mock the mainnet edge.** Base Sepolia is the live surface. For story 4, assert `eip155:8453` vs `eip155:84532` config switching and the secret-handling contract with fakes. Never spend real funds, never put CDP secrets in CI. The story-4 step 9 "$0.01 real purchase" becomes a documented manual-only, out-of-band step — not a gate. |
| Deliverable | **A markdown doc in `docs/` plus backlog items in `docs/backlog/`.** The doc is the reference; every identified gap also becomes a trackable item (use the `backlog-ideate` skill, then `backlog-audit` to regenerate `docs/backlog/INDEX.md`). |

### Open questions — ask these first, reframed

The second question round was rejected with "the user wants to clarify these
questions." Start by asking what they'd like to clarify, then re-ask. The three
axes, and why each changes the plan:

1. **Grading non-deterministic agent output.** Stories 1 and 3 hinge on
   agent-authored conversation — the first-run narrative, the response to
   "Not now" and "I got stuck." Wording is never identical twice. Options
   framed last time: (a) extend `evals/` with LLM-judged rubrics
   ("always names the next action", "never leaves a raw URL in prose");
   (b) deterministic structural invariants only (a card is always emitted, it
   carries a domain and an action label, state stays resumable, no bare URL in
   card prose) with tone left to human review; (c) both — invariants gate CI,
   rubrics run on a cadence as a non-blocking signal.
2. **Accessibility depth.** Story 2 requires VoiceOver announcing "See this
   payment on Basescan." Options: automated accessible-name/role assertions in
   the Playwright harness *plus* a scripted manual VoiceOver pass; manual
   VoiceOver only; or automated assertions only.
3. **Standing in for external dependencies** below the manual layer —
   Cloudflare, Coinbase CDP, the faucet, Basescan. Options: hand-written local
   fakes plus contract tests pinning the request/response shapes; record/replay
   HTTP fixtures; or hermetic fakes in PR CI with the existing
   `.github/workflows/deploy-qa.yml` path exercising real Cloudflare + the
   testnet facilitator on a cadence to catch drift.

Possible reasons the questions landed badly, worth probing: they may be too
implementation-flavored for this stage, may have presented false either/ors, or
may have assumed familiarity with `evals/` internals. Consider asking one at a
time, or asking what shape of plan they picture before forcing the choices.

### Repo reconnaissance (already done — reuse, don't redo)

Test infrastructure that exists today:

| Layer | Where | Notes |
|---|---|---|
| Python unit/contract | `tests/` | unittest, runs in CI. Includes `test_ui.py`, `test_mcp_contract.py`, `test_store.py`, `test_deploy.py`, `test_capture.py`, `test_skill_contract.py`, `test_snapshot.py`, `test_automation.py`, `test_blueprint.py`, `test_install.py`, `test_package.py`, `test_paths.py`, `test_sources.py`, `test_cli.py`, `test_pr_templates.py`, plus `tests/node/`, `gate.py`, `helpers.py` |
| Desktop | `app/desktop/test/app.test.cjs` | `node --test`, **main process only — no renderer coverage** |
| Desktop support scripts | `app/desktop/support/` | `edge.sh` (seller / provision / store), `dogfood.sh` (`new` \| `current`), `credential-roundtrip.cjs`, `screenshot.cjs`; also `app/desktop/test-capture.sh` |
| Node/Worker component | `lore/node/test/*.test.ts` | vitest against a mocked facilitator: `paid-path`, `price`, `storefront`, `wallet`, `network`, `answer*`, `mcp-contract`; `vitest.eval.config.ts` for evals |
| Worker integration | `worker-smoke` CI job | seeds a local D1 `publications` table, runs `npm run dev` + `npm run smoke` |
| Agent behavior | `evals/` | `run.py`, `buyer.py`, `integration.py`, `task.json`, `buyer_task.json` |
| CI | `.github/workflows/tests.yml` | jobs: python-lint, python-unit, python-types, bridge-check, desktop-check (macos-14: check, test, package), node-lint, node-compiler, node-component, worker-smoke. Also `deploy-qa.yml`, `pr-title.yml` |

Known coverage gaps mapped to the stories:

- **No renderer/UI automation at all** — blocks automated coverage of stories 1–3.
- No coverage of the first-run narrative or cohesion (story 1's stated risk).
- No coverage of attended browser-card flows: `Not now`, `I got stuck`, `Done`,
  resumability, "no raw URL left in prose" (story 3).
- No accessibility assertions anywhere; no VoiceOver procedure (story 2).
- No settled-payment integration gate on Base Sepolia (story 2 step 3).
- No mainnet switch coverage; no test of the "passed to Cloudflare, not saved
  locally" secret-handling claim (story 4 steps 4–8) —
  `support/credential-roundtrip.cjs` is the nearest existing thing and should be
  read before designing this.
- Relaunch/persistence across a sandbox restart (story 1 steps 6–7) is untested.

### Suggested shape of the final doc

A story × test-level matrix is the core: for each of the 4 stories, what is
covered at each level, by which suite, in which phase, and what is manual and
why. Plus entry/exit criteria for the launch gate, and the Phase 1 → Phase 2
conversion list. Then one backlog item per gap.

### Constraints from the repo

- Follow the project's linked-intent development workflow (`linked-intent-dev`
  skill) for any code changes — HLD → LLD → EARS → edge audit → tests → code.
- Backlog items live under `docs/backlog/` with an `INDEX.md` that is
  regenerated, not hand-edited; use the `backlog-*` skills.
- `docs/` is a flat directory of kebab-case markdown files.
- Relevant existing docs to read before writing: `docs/desktop-app.md`,
  `docs/gamified-onboarding.md`, `docs/manual-capture-ux.md`,
  `docs/demo-buyer-live.md`, `docs/agent-runtime-capture.md`,
  `docs/answer-tier.md`.
- The `github` MCP server failed to connect this session (bad Authorization
  header) — it is configured, not missing. Retry or use `gh`.

### The four user stories, verbatim

**1. Net-new user: reach private value.**
*Story:* As someone opening Lore for the first time, I want to understand it and
save something useful without needing a terminal.
`npm --prefix app/desktop run dogfood:new`
Flow: 1. Sign in with Claude or ChatGPT. 2. Follow Connect your agents → Shape
your Lore → Set the rhythm. 3. Modify the proposed Lore shape before accepting
it. 4. Capture a real anecdote. Edit one proposed memory, drop another, then
save. 5. Open Memories; read, rename, and edit the saved memory. 6. Quit and
relaunch using the same sandbox command printed by `dogfood:new`. 7. Confirm
sign-in, setup state, and the memory survived.
*Pass if* the user reaches a useful saved memory without coaching or terminal use
and always understands the next action.
*Important gap to probe:* the progressive setup rails exist, but a cohesive
first-run narrative remains unbuilt. That becomes a launch blocker only if this
run leaves you asking "what is Lore?" or "what do I do now?"

**2. Existing user X: understand a sale.**
*User problem:* "Something sold; show me what sold, how much, and where the
payment went."
Flow: 1. Launch your current profile: `npm --prefix app/desktop run
dogfood:current`. 2. Open For Sale and verify the honest empty-sales state.
3. Make one test-network purchase from the separate buyer harness or another
buyer. 4. Leave and re-enter For Sale to refresh. 5. Verify title, date, price,
total, and last-sale summary. 6. Open the receipt and confirm it uses Base
Sepolia's explorer. 7. With VoiceOver, focus the ↗ and confirm it announces
"See this payment on Basescan."
*Pass if* the sale is immediately attributable and the receipt is usable without
sight.

**3. Existing user Y: complete browser-dependent payment setup.**
*User problem:* "Guide me through external pages; don't paste URLs or strand me
during setup."
Flow: 1. Start or resume Open your store. 2. On the first browser card, choose
Not now; confirm the task remains resumable. 3. Retry and verify the card
explains the step and names the destination domain. 4. Click Open …; confirm the
correct page opens. 5. Return and choose I got stuck; verify the agent responds
to that state. 6. Retry, finish the browser step, and choose Done. 7. Exercise
Cloudflare sign-in and one wallet/faucet/Basescan step. 8. Confirm no raw URL is
left for you to copy from prose. 9. Complete the test-network deployment and Push.
*Pass if* every external action is framed, resumable, and returns control to the
same task.

**4. Existing user Z: switch to real payments and back.**
*User problem:* "Take my proven store to real money without asking me to use a
terminal for secrets."
*Prerequisites:* one active publication, one settled test payment, and explicit
intent to switch.
Flow: 1. In Settings, choose Switch to real payments. 2. Confirm Coinbase
Developer Platform opens through an attended browser card. 3. On the first secret
prompt, click Not now; verify nothing is stored and retry works. 4. Enter the API
key ID and secret separately. 5. Confirm the fields are masked, values never
appear in the conversation, and the copy accurately says Lore passes them to
Cloudflare without saving them locally. 6. Complete the deployment. 7. Verify
Settings says buyers pay real money and the node reports `eip155:8453`. 8. Choose
Switch to play money; verify it returns to `eip155:84532`. 9. For maximum
confidence, make one $0.01 real purchase from a separate buyer and confirm the
sale links to mainnet Basescan.

---

## For you, resuming later

- **Where we stopped:** scoping questions, before any plan was written. No files
  changed, nothing committed.
- **What this is:** a test plan across all levels for Dipak's four dogfood
  stories — not just an e2e checklist.
- **Four things you already decided:**
  - Phased — a launch gate first, CI automation second.
  - Build a Playwright + Electron harness for the renderer (accepted the lift).
  - Testnet only; mock the mainnet edge; the real $0.01 purchase stays manual and
    out of band.
  - Ship a doc in `docs/` **and** backlog items in `docs/backlog/`.
- **Three things still open** (you asked to clarify the questions rather than
  answer them):
  - How to grade the agent's conversational output, which is never worded the
    same twice — LLM-judged rubrics in `evals/`, deterministic structural
    invariants only, or both.
  - How deep on accessibility — automated accessible-name assertions plus a
    manual VoiceOver pass, manual only, or automated only.
  - How to stand in for Cloudflare / CDP / faucet / Basescan below the manual
    layer — local fakes, recorded fixtures, or fakes in CI with the real thing
    exercised on a cadence via `deploy-qa.yml`.
- **The big finding:** desktop tests only exercise the main process. There is
  **zero** renderer coverage today, which is why stories 1–3 have no automated
  path at all right now.
- **Other gaps found:** no first-run narrative coverage, no browser-card flow
  coverage, no accessibility assertions anywhere, no settled-testnet-payment
  gate, no mainnet-switch or secret-handling coverage, no relaunch-persistence
  test.
- **To resume:** point the agent at this file. It will start by asking what you'd
  like to clarify about those three open questions.
