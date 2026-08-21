---
id: ONB-003
title: Let the agent bootstrap the Lore runtime
priority: P2
effort: S
component: onboarding
status: completed
related: [ONB-002, XC-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-20
updated: 2026-08-20
---

## Problem

Installing the Lore plugin does not install its local runtime. When `lore` or
`uv` is missing, onboarding exposes developer prerequisites and stops instead
of offering an owner-friendly, agent-driven installation.

## Proposed approach

Keep the plugin and runtime separate, but make the handoff conversational. The
agent should explain the local install, ask permission, run it, and verify it.
The installer should bootstrap `uv` when needed and let `uv` supply a compatible
Python rather than requiring the owner to prepare either tool.

## Acceptance criteria

- [x] When `lore` is missing, onboarding explains what will be installed and
      waits for the owner's permission.
- [x] The agent runs the installation and never asks the owner to type or
      understand `curl`.
- [x] `install.sh` bootstraps a missing `uv` and does not require a preinstalled
      Python interpreter.
- [x] Onboarding verifies `lore status` before continuing to setup; declining
      or a failed installation stops cleanly.
- [x] A test exercises the missing-`uv` installer path without network access.

## Notes

The existing isolated install succeeds when `uv` is already available. With
`uv` absent it exits immediately with `Lore needs uv`, confirming the gap is the
bootstrap seam rather than the Lore package installation itself.

The installer now uses uv's standalone bootstrap and lets uv choose a compatible
managed Python. The network-free test replaces only the uv download and package
installation while exercising the installer's real branching, paths, executable,
and skill-copy behavior. A separate real clean-room run started from system Python
3.9 with no uv, installed Python 3.14.7, and completed `lore status` successfully.
