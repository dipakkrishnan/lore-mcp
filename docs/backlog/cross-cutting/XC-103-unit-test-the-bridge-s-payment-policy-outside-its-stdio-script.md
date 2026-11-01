---
id: XC-103
title: Unit-test the bridge's payment policy outside its stdio script
priority: P2
effort: S
component: cross-cutting
status: ready
related: [XC-099]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

`bridge/src/index.ts` is a top-level-await script with no exports:
`parseArgs`, `process.exit` and `connect` run at load. Its only test,
`bridge/scripts/test.ts` (152 lines, about 1.8 s in CI), spawns the bridge as
a child process over `StdioClientTransport` against an in-process express
fixture and covers the price annotation, declining a decoy challenge with an
off-network entry, exactly one sign-and-retry, the receipt in the tool
result, and the cumulative spend cap. Not covered: `bridgeKey` key-file
provisioning (34-60), the base64 branch of `decodeReceipt` (64-74),
`--max-usd` validation (89-93) and a malformed `X402_PRIVATE_KEY`. The
confirmation policy (114-150) is the part that handles money, and it can only
be tested end to end.

## Proposed approach

Extract `approve(accepts, network, authorized, cap)`, `decodeReceipt` and
the arg and cap parsing into `bridge/src/policy.ts` with no side effects at
load, called from `index.ts`. Add `node:test` tests (bridge has no test
framework; `node --test` needs none) for the decoy case, the cap arithmetic,
both receipt encodings, cap validation and the malformed-key path. Keep
`scripts/test.ts` as the one end-to-end run. Wire `npm test` to run both.

## Acceptance criteria

- [ ] `bridge/src/policy.ts` exports the policy functions and has no
      top-level side effects.
- [ ] `bridge/test/policy.test.ts` covers the five uncovered paths named in
      Problem and runs in under 1 s.
- [ ] `scripts/test.ts` passes unchanged.
- [ ] Layout scan: this item touches no walk; no view scanned by the desktop
      walks before this change is unscanned after it.

## Notes

- Workstream C5 of the test-pyramid plan.
