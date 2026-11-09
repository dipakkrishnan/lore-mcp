---
id: XC-100
title: Extract the Worker's pure rules into leaf modules with table tests
priority: P2
effort: M
component: cross-cutting
status: completed
related: [XC-099, XC-101, XC-088]
blockers: [XC-099]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-11-09
---

## Problem

Much of `lore/node`'s logic is reachable only through `exports.default.fetch`
inside workerd, so every rule costs a Worker boot to test and is asserted
through HTTP shapes rather than directly. The 2026-10-29 survey of `src/`
(5,388 lines) found these pure rules buried in the fetch path of
`src/index.ts`: route matching for the page, `/p/<id>(.json|/)` and
`/p/<id>/(paid|free)` (lines 505-534) and `FREE_COOKIE` parsing (438-445);
`takesCards` (471), `priceOf` (473), `storeFor` (457-469), the lookup half
of `sellable` (373-398) and receipt matching in `paidFor` (343). Elsewhere:
`readAnswerSettings` (`answer-state.ts:122-150`) mixes a D1 query with the
enabled rule, `freeCopies` parsing, price fallback and the fail-closed
default; `systemPrompt` and `resolveModel` (`answer.ts:29,44`) sit behind
tracing's `cloudflare:workers` import; `ticketResult`
(`answer-state.ts:291-322`) is a deadline rule with a result shape; the agent
`Save` schema and `chars` code-point rule (`agent.ts:23-45`) are tested only
through MCP. `index.ts` may export only `default` (the Workers runtime
refuses more, as `checkout.test.ts:132` pins), so none of this can be
exported from where it lives.

## Proposed approach

Create leaf modules and move the rules without changing behaviour:
`src/routes.ts` (route and cookie parsing), `src/pricing.ts` (`takesCards`,
`priceOf`, `storeFor`, `sellable`'s lookup, receipt matching),
`src/settings.ts` (`parseSettings(rows)` called by `readAnswerSettings`),
`src/answer/prompt.ts` (`systemPrompt`, `resolveModel`, no tracing import),
`ticketResult` as a pure function of `(ticket, now)`, and the agent schema
and `chars` in `src/agent-schema.ts`. Give each a table test in
`test/unit/` under XC-099's node project. Apply the same to the hosted
Worker's host-to-binding routing in `src/hosted/index.ts` (XC-088). Existing
workerd tests keep passing unchanged, which is the proof the move was pure.

## Acceptance criteria

- [x] Each rule named in Problem lives in a leaf module with no
      `cloudflare:workers` import and has a table test in `test/unit/`.
- [x] `src/index.ts` and `src/hosted/index.ts` still export only `default`
      (besides the Durable Object class each wrangler config binds, which
      they always exported; see Notes).
- [x] Every existing workerd test passes unchanged.
- [x] The node project holds at least 60 tests after this item (258).
- [x] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it. The storefront pages
      the Worker serves are not scanned by any walk today; that gap predates
      this item and is noted, not widened.

## Notes

- Workstream C2 of the test-pyramid plan.
- The MCP tool contract check (`test/mcp-contract.test.ts` against
  `contracts/mcp_tools.json`) stays in workerd: a pure export of the tool
  strings would lose the proof of what is registered at runtime. XC-101
  folds it into `request-path` to save its Worker boot.
- Where each rule went (no new module imports a `cloudflare:` module; the node
  project's guard test walks every unit test's import graph and passes):
  - `src/routes.ts`: `pageRoute` (`/`, `/p/<id>`, `.json`, `/`), `postRoute`
    (`/p/<id>/(paid|free)`), `freeCookie` and `freeCookieHeader` ->
    `test/unit/routes.test.ts` (37 tests).
  - `src/pricing.ts`: `priceOf`, `takesCards`, `storeFor` (now takes the
    origin, not the URL), `findItem` (the lookup half of `sellable`),
    `verifiable` (the session/account check before asking checkout) and
    `paidBy` (receipt matching from `paidFor`) -> `pricing.test.ts` (38).
  - `src/settings.ts`: `AnswerSettings`, `parseSettings(rows)` and the
    fail-closed `CLOSED`; `readAnswerSettings` keeps the D1 query and calls
    it -> `settings.test.ts` (31, including `readAnswerSettings` against a fake
    D1 that throws, which pins the fail-closed default without a Worker).
  - `src/answer/prompt.ts`: `systemPrompt`, `resolveModel`, `DEFAULT_MODEL`,
    `AnswerEnv` -> `prompt.test.ts` (16).
  - `src/answer/ticket.ts`: `overdue(job, now)` and `resultOf(job)`, the pure
    halves of `ticketResult`, which keeps only the reads, the live-checkpoint
    check and the expiring write -> `ticket.test.ts` (16).
  - `src/agent-schema.ts`: `chars`, `key`, `Save` -> `agent-schema.test.ts` (32).
  - `src/hosted/routes.ts` (XC-088): `STORE`, `storeOf`, and `otherOf` (host to
    binding, prototype names refused) -> `hosted-routes.test.ts` (24).
  Old import paths still work: `answer-state.ts` re-exports `AnswerSettings`,
  `AnswerJob`, `ANSWER_DISCLOSURE` and `ESTIMATE_SECONDS`; `answer.ts`
  re-exports `AnswerEnv`.
- Premise correction: neither entry module ever exported only `default`.
  `src/index.ts` also exports `LorePaidMCP` and `src/hosted/index.ts`
  `HostedStore`: the Durable Object classes their wrangler configs bind, which
  the runtime needs on the main module (`checkout.test.ts:132` pins the
  checkout Worker, which has none). What this item holds is that no rule is
  exported from them. `src/hosted/index.ts` also dropped its `STORE` export (it
  lives in `hosted/routes.ts`; nothing imported it), and
  `test/unit/entries.test.ts` reads both entry modules' source and fails if any
  runtime export other than `default` and that class appears.
- Measured locally (Node 25, M-series Mac): the node project went from 7 files /
  61 tests to 15 files / 258 tests, in 0.38 s (`npm run test:unit`). The main
  `npm run test:coverage` run is 33 files / 406 tests in 61 s; the 18 workerd
  files and their 148 tests are untouched (`git diff origin/main --
  lore/node/test` shows only new files under `test/unit/`). The hosted run is
  1 file / 18 tests. Coverage, main report: statements 96.83%, branches 91.42%,
  functions 97.26%, lines 98.38%; hosted report: 94.41 / 86.27 / 91.48 / 98.1%.
- The "at least 60" floor was already met before this item: XC-099 left the
  node project at 61 tests.
- Layout scan: the diff is confined to `lore/node/src`, `lore/node/test/unit`,
  this file and `INDEX.md`; no desktop walk or view is touched.
