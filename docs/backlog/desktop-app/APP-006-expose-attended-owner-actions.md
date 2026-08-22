---
id: APP-006
title: Expose attended owner actions without weakening approval
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-004, APP-005, XC-017]
blockers: [APP-004]
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-08-22
---

## Problem

Publishing, pricing, paid answers, pushing, and deployment are still terminal
workflows. Simply allowing Pi to run them through Bash would blur generic shell
approval with Lore's stronger owner-only disclosure and payment approvals.

## Proposed approach

Let embedded Pi use the existing `lore-publish` and
`lore-enable-payments` skills for guidance and drafting, but invoke each
owner-only action from a narrow app control through its existing Lore CLI
validation path. Keep these controls separate from `ask_user` and native Bash
approval; do not add a general command IPC surface or reproduce validation in
Electron.

## Acceptance criteria

- [ ] An owner can draft a bounded publication through the existing skill and
      review the exact candidate before any disclosure occurs.
- [ ] Publication, proxy-answer, pricing, revoke, push, and deploy actions run
      through existing Lore validation and preserve every attended approval.
- [ ] Generic Bash approval cannot approve a publication, proxy charter, or
      payment/deployment decision on the owner's behalf.
- [ ] The app never requests or stores a seed phrase, private key, or buyer
      spending credential; it accepts only the public payout address required
      by the existing payment flow.
- [ ] Fixed typed IPC covers only the supported actions and rejects arbitrary
      commands and malformed input.

## Notes

Implementation must first decide how Electron hosts the CLI's real attended
TTY approval without weakening it. Do not replace that gate with a renderer
boolean or have Pi answer it.
