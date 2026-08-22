---
id: APP-008
title: Evaluate learned Bash auto mode after real use
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-003, APP-004]
blockers: []
dependencies: ["Evidence from real owner command and approval usage"]
github_issue: null
created: 2026-08-22
updated: 2026-08-22
---

## Problem

APP-003's deterministic Bash rules are intentionally narrow. Evolving skill
commands may eventually create approval friction or remain blocked until the
rules catch up, but adding a learned classifier before real usage demonstrates
that problem would add cost and uncertainty to a working security boundary.

## Proposed approach

Wait for real command and approval evidence. If it shows material friction,
evaluate an optional learned risk signal only inside a deterministic envelope
of commands already eligible to run; deterministic hard-denies execute first
and cannot be overridden. Unavailable, uncertain, or malformed classifier
output falls back to the deterministic decision.

## Acceptance criteria

- [ ] Real owner usage demonstrates and documents approval friction or repeated
      safe-command lag before implementation begins.
- [ ] Deterministic hard-denies remain authoritative for non-Lore, compound,
      owner-only, and otherwise unsupported commands regardless of classifier
      output.
- [ ] The classifier is described and tested as a prompt-reduction hint, never
      as a security boundary, and failure falls back to the deterministic
      policy.
- [ ] A bounded comparison shows fewer unnecessary prompts without increasing
      the set of commands eligible to bypass deterministic hard-denies.

## Notes

Do not log private capture payloads or send credentials to collect the evidence
for this decision.
