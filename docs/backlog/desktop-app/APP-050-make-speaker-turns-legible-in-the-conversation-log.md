---
id: APP-050
title: Make it easier to tell owner and Lore turns apart in the conversation log
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-016]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-02
updated: 2026-09-02
---

## Problem

In the thread log (`.log .line`, `src/styles.css:187-199`), the only signal
distinguishing an owner line from a Lore line is a tiny 10px uppercase "YOU"
label (owner only — Lore turns get no text label, just the circular mark
icon) and a subtle text-color difference (`--ink` vs `--ink-soft`, both
dark). Line spacing is a uniform 10px regardless of whether consecutive
lines are the same speaker or a turn switch. On a long thread (the reported
screenshot is a full setup conversation) it's genuinely hard to scan who
said what without reading the small label on every line.

## Proposed approach

A few candidate directions, not mutually exclusive — worth a real design
pass rather than picking blind:
- **Symmetric labels**: Lore turns currently have no text label at all,
  only the mark icon; owner turns have a label but no icon. Give both
  speakers a consistent labeled treatment (e.g. "LORE" next to the mark,
  matching "YOU"'s treatment) instead of an asymmetric icon-vs-label split.
- **Stronger left-edge cue**: a thin colored rule or background tint on one
  speaker's lines (or both, in different tones) so the eye can scan the left
  edge down the thread without reading every label.
- **Turn-based spacing rhythm**: tighten spacing between consecutive lines
  from the same speaker and widen it at a speaker switch, instead of the
  current uniform 10px gap — spacing alone is a strong, low-noise turn-taking
  signal independent of color/label legibility.
- **Wider contrast**: `--ink` vs `--ink-soft` is a subtle difference: widen
  it, or give the owner (or Lore) an accent color, rather than relying on
  the tiny label as the primary differentiator.
Should stay in keeping with the existing sparse, editorial (non-bubble) log
style rather than becoming a boxed chat-bubble UI.

## Acceptance criteria

- [ ] An owner can tell, at a glance and without reading the per-line
      label, which lines are theirs vs. Lore's on a long real thread.
- [ ] Change is visually consistent with the existing `.log` styling
      (typography, spacing scale, color tokens in `styles.css`).

## Notes

Reported by the owner while dogfooding (2026-09-02), with a screenshot of a
full setup thread where "YOU" is the only text differentiator and the color
difference between speakers is subtle.
