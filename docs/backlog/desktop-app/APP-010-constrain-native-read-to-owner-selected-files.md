---
id: APP-010
title: Constrain native read to owner-selected files
priority: P1
effort: M
component: desktop-app
status: ready
related: [APP-003, APP-005, APP-009]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-08-26
---

## Problem

The embedded Pi `read` tool accepts absolute paths, expands `~`, and follows
filesystem links without a Lore-owned root check. The renderer's attachment
filter improves the attended experience, but it does not stop the model from
reading any file allowed by the macOS process and sending its contents to the
configured model provider.

## Proposed approach

Replace the session's native `read` registration with the same Pi read tool
backed by a small path policy. Canonicalize requested paths before allowing
explicit owner attachments, Lore's own runtime and bundled skill resources,
and the narrow history roots the owner approves during onboarding; deny
everything else before opening the file.

## Acceptance criteria

- [ ] A read outside the approved files and roots is blocked before file bytes
      reach the model provider.
- [ ] Canonical path checks reject `..` traversal and symlink escapes.
- [ ] An owner-selected attachment and a bundled skill
      resource remain readable, while a rejected credential-shaped attachment
      does not.
- [ ] Onboarding can read explicitly approved Claude or Codex history roots
      without granting access to the rest of the home directory.
- [ ] Tests cover `/etc/hosts`, a file under `~/.ssh`, a symlink escape, an
      allowed attachment, and an allowed skill path.

## Notes

Verified against the installed `@earendil-works/pi-coding-agent`: its default
read operations resolve absolute paths and call the filesystem directly. This
is unrestricted only within the permissions macOS grants the Electron process;
it does not bypass operating-system protections.

**Prioritization pass 2026-08-26:** No blockers, no open design question — path-policy shape and test list are concrete. Promoted `in-review` → `ready`.
