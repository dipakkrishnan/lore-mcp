---
id: APP-004
title: Drive setup and owner actions through existing Lore skills
priority: P1
effort: L
component: desktop-app
status: in-review
related: [APP-003, ONB-003, AUT-001, XC-005, XC-017]
blockers: [APP-003]
dependencies: []
github_issue: null
created: 2026-08-21
updated: 2026-08-22
---

## Problem

A desktop app that merely exposes controls would recreate Lore's onboarding,
privacy, publishing, and payment rules in UI code. A new owner instead needs a
guided first run that imports existing agent context, asks for corrections,
sets up ongoing synthesis, and optionally configures a payout address and
deployment without requiring terminal knowledge.

## Proposed approach

Let embedded Pi drive the existing `lore-onboard`, `lore-publish`, and
`lore-enable-payments` skills while Electron renders questions, approvals,
links, and progress natively. Derive the setup checklist from `APP-001` rather
than adding an onboarding state machine. Route review, approve, revoke, price,
push, and deploy actions through the existing Lore validation paths.

How a skill executes inside the app: the relevant `SKILL.md` loads verbatim as
the Pi session's instructions, and Pi never receives a shell. Its tool surface
is exactly three seams — `lore_cli`, which spawns the packaged `lore` binary
with an allowlisted argv (`status`, `setup`, `sync`, `search`, `capture
apply`, `blueprint apply`, `profile`, `price`, `publication list`, `push`,
`node deploy`) and rejects everything else, including the attended approval
subcommands, which stay app-invoked; a read-only file tool scoped to the
agent-history roots the skills import from and to Lore-written draft files;
and the `ask_user` seam from `APP-003`. The skills' shell blocks are almost
entirely `lore` invocations, so their instructions map onto this surface
without rewriting them; skill steps that install the runtime short-circuit
because the app has already provisioned it (`APP-005`).

Record only local owner-job status and resumable Pi session state in the
existing Lore SQLite database. "Resume" is state-derived, not transcript
restoration: Pi has no built-in session persistence (the answer path resumes
by replaying a checkpointed message array, `MON-015`), and for owner setup
the durable truth is Lore state, not a transcript — a replayed conversation
can act on facts the owner has since changed. After a restart the app starts
a fresh Pi session seeded with the current `APP-001` snapshot and the active
skill, and the checklist plus jobs table carry the progress. Do not build
transcript checkpointing for setup flows. Windup or the operating-system
scheduler remains the scheduler; the app only displays those runs and can
initiate an attended run.

## Acceptance criteria

- [ ] A net-new owner can install Lore, auto-scan supported agent history,
      correct proposed memories, establish a blueprint, and install synthesis
      without typing terminal commands.
- [ ] The optional Monetize path collects only a payout address and price,
      never a seed phrase, private key, or buyer spending credential, then
      deploys and verifies the node through the existing payment skill.
- [ ] Publication, pricing, answer, push, and deployment actions preserve the
      existing attended approval and validation guarantees.
- [ ] Setup progress is derived from real Lore state and resumes after the app
      or Pi session restarts.
- [ ] One minimal jobs table in the existing local SQLite database records job
      kind, status, summary/error, and timestamps for capture, synthesis, and
      deployment runs shown on Today.
- [ ] Once setup is complete, the setup checklist disappears and the app opens
      into the three-view vendor console.

## Notes

The skills remain the owner-journey source of truth. The app is their native
host, not a parallel wizard. `XC-005` should supply the conversational dry-run
methodology — run each skill under Pi with this exact tool surface in a
terminal harness before any Electron wiring, since a skill step that assumes a
capability outside the three seams is a skill bug to fix in the skill, not a
reason to widen the surface.
