---
id: APP-005
title: Package and prove the macOS desktop happy path
priority: P1
effort: L
component: desktop-app
status: in-review
related: [APP-004, APP-006, APP-007, EVAL-002, XC-008]
blockers: [APP-004, APP-006, APP-007]
dependencies: ["Apple Developer signing credentials for public distribution", "A testnet-funded buyer wallet for the live paid-path proof"]
github_issue: null
created: 2026-08-21
updated: 2026-08-22
---

## Problem

Individual screens and mocked tool calls cannot prove that an ordinary new
owner can install the app, build useful Lore, publish it, and see a buyer use
it. Without an installable artifact and a repeatable happy-path proof, the
desktop experience can appear complete while failing at runtime, deployment,
or payment boundaries.

## Proposed approach

Package the macOS app and exercise one synthetic net-new persona end to end:
first launch, agent-history import, attended capture, synthesis setup,
publication approval, payout and price setup, test deployment, testnet buyer
call, and confirmation in the Store and Today views. Automate the local path;
keep the credentialed deployment and payment portion as an explicit bounded
live test.

Runtime provisioning, so a clean machine needs no terminal: ship the `uv`
binary and a prebuilt wheelhouse (the `lore-mcp` wheel, a `windup` wheel, and
their dependencies — the git dependency must be wheeled at build time so
first launch needs no git) inside the app bundle's Resources. On first launch
the app runs `uv tool install --find-links <Resources/wheels>` into an
app-owned prefix, letting `uv` fetch its pinned managed Python; network on
first launch is acceptable because inference already requires it. Pin every
version at package time and sign all bundled Mach-O binaries as part of
notarization. This supersedes the earlier "require the Lore runtime to be
installed first" stance, which contradicted the clean-machine criterion. An
existing `~/.local` CLI install is left untouched; the app prefers its own
prefix.

## Acceptance criteria

- [ ] A clean macOS account can install and launch the packaged app without a
      separately prepared Python, Node, or terminal environment.
- [ ] The automated local test uses a temporary Lore home and proves first run
      through private memory creation, publication approval, and local push.
- [ ] A documented bounded live test deploys the synthetic persona, completes
      one testnet buyer request, and shows the resulting job and cost in the
      app.
- [ ] The release artifact passes macOS signature and notarization verification
      when the listed Apple credentials are supplied.
- [ ] No production wallet funds, owner-private memories, or persistent test
      credentials are used.

## Notes

Windows, Linux, auto-update infrastructure, custom audio, cloud sync, local
models, trend charts, and the menu-bar/global-shortcut capture surface are out
of scope. Add them only after real owner usage shows which one is necessary.
