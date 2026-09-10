---
id: APP-035
title: Enable optional paid answers through a Desktop owner gate
priority: P2
effort: M
component: desktop-app
status: completed
related: [APP-006, APP-008, APP-019, APP-030, APP-105, XC-017, MCP-003, MON-017, MON-024]
blockers: [MON-017]
dependencies: ["Publication-only desktop dogfood shows paid answers are worth surfacing"]
github_issue: null
created: 2026-08-25
updated: 2026-09-09
---

## Problem

Lore already supports an optional paid-answer tier, but Desktop has no safe way
to enable it. PR #155 briefly treated `LORE_ATTENDED_SURFACE=desktop` plus piped
stdin as owner attendance; the embedded agent's Bash tool can forge that marker
and approve its own charter and price. Paid answers are not needed to prove the
core publication-store loop, so carrying that bridge in APP-030 adds risk and
scope without helping current dogfood.

## Proposed approach

After publication-only dogfood demonstrates demand, add one seller-side
Desktop action for the existing tier. The owner reviews the exact public proxy
charter and per-answer price together, then explicitly enables, updates, or
disables them through a fixed main-process action that reuses Lore's validation.
Do not trust an environment variable, agent Bash, or a renderer boolean as
proof of approval.

Keep charter drafting in the payments skill and keep the answer runtime,
pricing storage, and `lore push` mechanics where they already live. This item
does not add a buyer chat, `answer`/`result` controls, answer-job analytics, or
per-publication pricing to Desktop.

## Acceptance criteria

- [x] Desktop shows the exact public proxy charter and per-answer price before
      the owner can enable the tier; declining changes nothing.
- [x] Agent Bash cannot enable, disable, or alter paid answers by setting
      `LORE_ATTENDED_SURFACE` or invoking the CLI directly.
- [x] The implementation reuses Lore's answer-settings validation and does not
      duplicate answer, pricing, or push mechanics in Electron.
- [x] Enabling and disabling remain optional; the publication-only deploy flow
      works unchanged without configuring an answer model or provider secret.
- [x] An approved change refreshes Desktop state and offers `lore push`; the UI
      does not claim the live node changed before that push succeeds.
- [x] Desktop adds no buyer-side `answer` or `result` experience.
- [x] A focused boundary test proves both the approved Desktop path and a forged
      agent-originated attempt.

## Notes

Split from APP-030 on 2026-08-25. The removed bridge already established the
useful UI shape—a typed charter-and-price review card—but its attendance signal
was not an authorization boundary. Do not restore that implementation unchanged.

`MON-017` must first ensure a node cannot advertise or charge for answers when
its configured model provider is unavailable. User validation may justify this
seller control; it does not justify widening Desktop into a buyer client.

**Implemented 2026-09-09**, alongside `MON-017` and `MON-024`:

- The unforgeable gate: `lore answer apply` (new CLI command, `cli.py`)
  requires `LORE_APPROVAL_TOKEN` to match a random token Electron main mints
  at launch (`main.cjs`'s `APPROVAL_TOKEN`) and writes under Electron's
  `userData`, a path `bashSandboxPolicy` (`agent.mjs`) now denies both read
  and write on. `LORE_ATTENDED_SURFACE` alone — forgeable by the agent's own
  Bash tool — is checked first but is not sufficient.
- Enable: a new `propose_answers` agent tool (mirrors `propose_price`) shows
  the owner the exact charter and price on a card in the deploy thread;
  `store_secret` gained `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` for the model
  provider key. A new `try_answer` tool runs one free trial question
  (`MON-024`) before the owner commits.
- Disable: a plain, reversible button in Settings, going through the same
  `lore answer apply` gate.
- "Does not claim the live node changed before push succeeds": the Settings
  and For Sale/Today rows now read a live-probed `answer_price_usd` (new
  `Manifest`/snapshot field) separately from the locally saved setting, the
  same way publication pricing already does — a saved-but-unpushed change
  shows "Buyers [still pay $X for an answer / can still ask questions at $X]
  until you redeploy," never the new number as if it were already live.
- Push after enabling happens conversationally — the `lore-enable-payments`
  skill already runs `lore push` itself once approved, unchanged from the
  terminal flow — rather than a dedicated UI card, which only the
  Settings-initiated disable path needs (nothing conversational is running
  when the owner clicks Turn off).
- The Bash-sandbox claim in `docs/desktop-app.md` rule 3 ("hard-denies every
  `lore publication` and `lore answer` mutation") was stale — there is no
  command-name denylist, only a filesystem/network policy — and has been
  corrected. `lore publication decide` has the same forgeable-marker gap this
  item closed for answers; `APP-105` tracks giving it the same fix.
- Verified: `uv run pytest` (380 tests), `npm test` (39, `app/desktop`),
  `npm run test:edge` (all four personas), `tsc --noEmit`, `ruff`, `mypy`,
  and the Worker suite (`lore/node`, 83 tests) all pass. Not verified in this
  pass: a live run against a real deployed Cloudflare node (needs a real
  account); see `MON-024`'s own note on that gap.
