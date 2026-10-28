---
id: APP-252
title: Run the desktop agent's tools inside the Windows sandbox
priority: P3
effort: L
component: desktop-app
status: ideation
related: [CLI-014, APP-251, APP-253]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-28
updated: 2026-10-28
---

## Problem

Every agent tool runs through @anthropic-ai/sandbox-runtime (agent.mjs:211-315). On macOS that is
Seatbelt. On Windows the runtime uses srt-win.exe (sandbox user, ACLs, WFP egress), which needs a
one-time UAC install, and forge.config.js:21 currently strips srt-win from the package. Lore's own
read/write/edit and turn-cleanup tools are sh one-liners (agent.mjs:336-362,749-758), pi's bash tool
needs Git Bash, and SANDBOX_TMPDIR plus the path checks assume "/".


## Proposed approach

Keep vendor/srt-win/x64 in Windows builds. Add a first-run step that explains and runs
`windows-install` (one UAC prompt) in plain words. Replace the sh tool scripts with one small Node
helper run inside the sandbox on both OSes. Decide whether to bundle MinGit or require Git for Windows
for pi's bash. Use path.sep / path.relative and os.tmpdir().


## Acceptance criteria

- [ ] On Windows 11 the agent can read/write only within Lore's home and listed folders; network
      egress is blocked (tests mirror the macOS sandbox walk)
- [ ] Refusing the UAC prompt leaves Lore usable for capture, with the agent features explained as off
- [ ] Synthesis of an imported ChatGPT export completes on Windows

## Notes

From the Oct 27 launch feedback; see `docs/launch-feedback-2026-10-27.md`.
