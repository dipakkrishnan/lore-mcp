---
id: XC-099
title: Give each Worker a node vitest project for its pure modules
priority: P1
effort: S
component: cross-cutting
status: ready
related: [XC-088, XC-098, XC-100, XC-101, XC-102]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

Every Worker test runs inside workerd through `@cloudflare/vitest-pool-workers`,
including tests of modules that never touch D1, a Durable Object or `fetch`.
In `lore/node`, nine files are pure and finish in milliseconds (`price`,
`wallet`, `network`, `storefront`, `telemetry` attributes, `answer-state` ids,
`refund`, `answer-tools`, `seal`), yet each is loaded into a Worker and, with
`fileParallelism: false` (from MCP-003, to dodge cold-start timeouts), waits
its turn behind files that boot the Worker at 3-5 s each. Locally the suite
reports 62 s wall for 41 s of tests; in CI the job is 90 s. The same shape
holds in `feedback-relay` and `checkout`, where `parseReport`, `parseBatch`,
`issueTitle` and `signed` are already tested directly but still in workerd.

## Proposed approach

Add a vitest workspace to each Worker with two projects: `node` (environment
`node`, `include: ["test/unit/**/*.test.ts"]`, v8 coverage) and `workerd`
(the existing pool-workers config, `test/**/*.test.ts` minus `unit/`).
Move the already-pure files to `test/unit/` with no source change; split
`open` out of `lore/node/test/inbox.ts` first so `seal.test.ts` stops
importing `cloudflare:workers`, and leave `withSpan` (tracing imports
`cloudflare:workers`) in the workerd half of `telemetry.test.ts`. The
hosted pool (XC-088, `vitest.hosted.config.ts`) stays a third, workerd-only
project. `npm test` runs all projects.

## Acceptance criteria

- [ ] `lore/node`, `feedback-relay` and `checkout` each have a `node`
      project and a `workerd` project; `npm test` runs both.
- [ ] The nine pure `lore/node` files run in the node project; the node
      project finishes in under 3 s locally.
- [ ] A guard test fails if any file under `test/unit/` imports
      `cloudflare:workers` or `cloudflare:test`.
- [ ] Total test counts are unchanged.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream C1 of the test-pyramid plan. XC-100 (leaf-module extraction),
  XC-101 (fewer Worker-boot files) and XC-102 (relay and checkout leaf
  modules) all land their tests in the node project.
- Survey finding: `fileParallelism: false` is also load-bearing because files
  share the D1 seed in `test/setup.ts`, mutate `env.LORE_WALLET`
  (`request-path.test.ts:28-31`) and spy on `globalThis.fetch`
  (`test/facilitator.ts:66`). Do not flip it here; XC-101 revisits it.
