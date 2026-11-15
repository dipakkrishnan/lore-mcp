---
id: APP-010
title: Constrain native read to owner-selected files
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-003, APP-005, APP-009]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-22
updated: 2026-11-13
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

**Delivery loop plan review (2026-11-12):** Moved back from `ready` to
`in-review`. Three implementation plans were written and each was
rejected by a plan reviewer that checked it against the code; the open
issues did not shrink between rounds, which suggests the item is
under-scoped as written. The reviewer's last open issues are below.
Labels such as "Test 2" or "R3" refer to that rejected plan, which
was not kept; the facts about the code stand on their own.

- Step 4's descriptor check cannot pass on macOS, so every read fails
  closed. `stat -f '%d:%i' /dev/fd/3` stats the fdesc/devfs node. It reports
  the right inode but the devfs device, not the file's device. Checked here:
  `sh -c 'exec 3</etc/hosts; stat -f "%d:%i" /dev/fd/3'` prints
  3166728219:92090783, while `stat -f %d:%i /etc/hosts` and Node's bigint
  statSync both print 16777229:92090783. The plan's own check (`stat -f
  '%d:%i' /dev/fd/0 </etc/hosts`) only showed that the command prints a
  dev:ino. It never compared the output with Node's. As written, every read,
  access and image sniff for allowed files would throw CANNOT_READ, and the
  existing 'inside' assertions in the read and swap tests would fail. Fix:
  fstat the open descriptor through stdin, `[ "$(stat -f '%d:%i' <&3)" =
  "$LORE_ID" ]`. Checked here, it prints 16777229:92090783, which matches
  Node. The plan should say that this form, compared against Node's
  statSync, is what gets verified.
- The nlink > 1 refusal covers only files under logs and SANDBOX_TMPDIR, but
  the plan's own reason for it applies equally to Lore's home. The sandboxed
  bash can write loreHome, so it can plant a hard link there (for example
  `ln /private/etc/hosts $LORE/x`, which is on the same Data volume).
  canonicalReadable would then accept $LORE/x: realpath leaves it inside
  lore, it is a regular file, and permitted() allows it. The read tool would
  return /etc/hosts bytes, which breaks AC1. A hard link to a home file is a
  path-based sandbox bypass of the same kind. Either refuse nlink > 1 in
  every root the agent can write (lore included) and add a unit test for a
  hard link inside lore, or explain in the plan why lore is exempt.

**Prioritization (2026-11-12):** Priority P2 (was P1). Stays in-review.
Before it can be ready: Rewrite the Problem against sandboxPolicy and
createSandboxedReadOperations (reads already blocked under $HOME). State
whether paths outside home, like /etc/hosts, are in scope. Add the hard-
link-inside-lore case as an explicit criterion, and name an fd-identity
check that works on macOS. Prioritization flag (not acted on): mostly
superseded by the APP-048/APP-227 Seatbelt read policy.

**Close-out (2026-11-13):** Stays in-review, as only partly superseded. Since APP-048 and APP-226,
`createSandboxedReadOperations` (`app/desktop/src/agent.mjs`) reads only
through Seatbelt under `sandboxPolicy`. That policy denies the whole
account home (so `~/.ssh` too) except Lore's home, the runtime, the skills
and setup's history roots. A link inside Lore's home that points out is
refused, and a folder swapped mid-read is refused (`sandbox.test.cjs`,
"read goes through the sandbox…"). Attachments go through
`attachments.cjs`, which refuses credential-shaped files and those Lore
didn't plant. Three things remain. (1) Paths outside the home, such as
`/etc/hosts`, are not in `denyRead`, so they are readable, and no test
covers them. The item must decide whether they are in scope. (2) No test
covers a hard link planted inside Lore's home (the 2026-11-12 plan review
case). (3) Criterion 5's named tests (`/etc/hosts`, `~/.ssh`) don't exist
as such. Rewrite the Problem and criteria against `sandboxPolicy` per the
prioritization note before this goes back to ready.
