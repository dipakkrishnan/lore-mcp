---
id: XC-100
title: Extract the Worker's pure rules into leaf modules with table tests
priority: P2
effort: M
component: cross-cutting
status: ready
related: [XC-099, XC-101, XC-088]
blockers: [XC-099]
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
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

- [ ] Each rule named in Problem lives in a leaf module with no
      `cloudflare:workers` import and has a table test in `test/unit/`.
- [ ] `src/index.ts` and `src/hosted/index.ts` still export only `default`.
- [ ] Every existing workerd test passes unchanged.
- [ ] The node project holds at least 60 tests after this item.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it. The storefront pages
      the Worker serves are not scanned by any walk today; that gap predates
      this item and is noted, not widened.

## Notes

- Workstream C2 of the test-pyramid plan.
- The MCP tool contract check (`test/mcp-contract.test.ts` against
  `contracts/mcp_tools.json`) stays in workerd: a pure export of the tool
  strings would lose the proof of what is registered at runtime. XC-101
  folds it into `request-path` to save its Worker boot.
