---
id: XC-005
title: Dry-run every owner skill as a conversation, not just a document
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [XC-004, MON-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

The skill contract tests (PR #42) prove owner skills as *documents*: every
command real, every route real, no line able to carry a secret. They cannot
prove the skills as *experiences* — whether the entry questions read well,
whether resume logic actually resumes cleanly when a session dies mid-flow,
whether Codex's plain-text fallback (no AskUserQuestion) stays coherent, or
whether an agent actually follows a hand-off between skills instead of
improvising. Those are precisely the failures an owner hits mid-setup, where
nothing else catches them.

## Proposed approach

A repeatable dry-run protocol per owner skill, run before calling any skill
done: one pass driven by Claude (structured-question path) and one by Codex
(text path), each including a deliberate mid-flow session kill and resume, and
each crossing at least one skill boundary (e.g. onboarding's hand-off offer
into the Monetize branch). Findings get filed against the skill, not fixed
inline. Ideally the transcript of each pass is kept as a fixture so a later
edit to the skill can be diffed against how it previously played. Unclear
whether any of this can be automated honestly — an LLM roleplaying an owner is
the same trap EVAL-001 exists to close — so this may stay a manual checklist,
and that is acceptable.

## Acceptance criteria

- [ ] A written dry-run checklist exists (what to run, on which agents, with a
      forced resume and a crossed skill boundary).
- [ ] `lore-onboard` and `lore-enable-payments` have each been dry-run on both
      agent paths at least once, with findings filed.

## Notes

From the PR #42 discussion of what the contract tests cannot cover. The other
un-automated items from that discussion are tracked elsewhere: live Base
Sepolia settlement (MON-002), the two-person paid test (MON-005).
