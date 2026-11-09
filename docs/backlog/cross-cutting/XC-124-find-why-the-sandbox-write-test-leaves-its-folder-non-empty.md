---
id: XC-124
title: Find why the sandbox write test's cleanup once found its folder not empty
priority: P2
effort: S
component: cross-cutting
status: ideation
related: [XC-072, XC-080, APP-289]
blockers: []
dependencies: []
github_issue: null
created: 2026-11-05
updated: 2026-11-05
---

## Problem

On PR #664 (run 41968862976, first attempt), the Desktop macOS checks failed in
`test/sandbox.test.cjs:302` ("write and edit go through the sandbox: never outside, through a link, or under a swapped
folder"). Every assertion passed. The failure came from the `finally` block:

```
ENOTEMPTY: directory not empty, rmdir '/private/var/folders/…/lore-sandbox-bxFoy4/lore'
```

So `rm(root, { recursive: true, force: true })` emptied `lore/`, then found an entry still inside when it removed the
folder itself. Something created an entry in `lore/` after `rm` had listed it.

## What's known

- This was the first time in the last 40 CI runs. It didn't happen in 12 runs of that test alone on an M-series Mac,
  and the job's rerun passed it.
- No PR #664 change touches the sandbox or this test.
- Every sandboxed write waits for its child process to close. `swapping()` SIGKILLs its process group, waits for it to
  exit, then puts `dir` back. So neither of those obviously leaves a writer behind.
- Still open: whether `SandboxManager.reset()` (awaited just before) leaves anything writing into the Lore home, and
  whether a swap loop killed between `rm "$1"` and `mv "$1.real" "$1"` can leave `dir.real` inside a moved symlink
  target.

## Proposed approach

Reproduce under load: loop the test with the CPU busy (CI load was around 40). Record `lsof +D` on the folder and list
what is left in `lore/` when `rm` fails. Then fix the actual cause. Don't add `maxRetries` to the `rm` call.

## Acceptance criteria

- [ ] The entry left behind, and what writes it, is named.
- [ ] The test's cleanup cannot race it, and 200 runs of the test under load pass.
