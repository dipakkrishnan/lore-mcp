---
id: XC-086
title: Recognize Cloudflare's real 'verify your email' refusal
priority: P0
effort: XS
component: cross-cutting
status: ideation
related: [XC-085, XC-087, XC-069]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

Wrangler rewrites Cloudflare's `email_verification_required` on every API call to
"Please verify your account's email address and try again." Lore matches "10034" or
"verify your email" (`deploy.py:824-826`, `main.cjs:369`), which that wording never
contains, and `_ensure_d1` (the first API call) doesn't check at all. Unverified owners
get the generic failure. The test fixture (`tests/test_deploy.py:150`) and edge stub
(`support/edge.cjs:298`) use the old wording, so tests pass.

## Proposed approach

One classifier used by both `_ensure_d1` and deploy that matches
`verify your account's email`, `email_verification_required` and `10034`; fixtures
replaced with wrangler 4.151.1's real output.

## Acceptance criteria

- [ ] Unverified-email refusals at d1 create and at deploy both show the verify-email copy.
- [ ] Fixtures quote the bundled wrangler's real text; a test fails if wrangler's wording drifts.

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
