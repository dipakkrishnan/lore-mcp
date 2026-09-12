---
id: APP-094
title: Say where memories go in plain words
priority: P1
effort: XS
component: desktop-app
status: completed
related: [APP-092, APP-051, XC-025]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-06
updated: 2026-09-06
---

## Problem

Settings said "Everything stays on this Mac. Only what you approve for sale
ever leaves." Capture, setup and publish send the relevant memories to the
signed-in model provider to do their work, so the first sentence is not
true, and an owner who later learns that has been told otherwise by the
app itself. The approval hint ("Only what you approve ever leaves this
Mac"), the closed-deploy card and the Memories tooltip made the same claim
(audit 2026-09-06).

## Proposed approach

Keep the three facts apart and say each once, in plain words: the library
is stored on this Mac; the signed-in provider (named as the owner knows it,
"Claude" or "ChatGPT") reads memories when it works with them here; buyers
only ever get what the owner approves for sale. Storage-only claims
("Saved, only on this Mac") stay, since they are about where the file is.

## Acceptance criteria

- [x] No copy in the app says that nothing leaves the Mac except approved publications.
- [x] Settings names storage, the provider, and buyers as three separate facts.
- [x] The provider is named by its sign-in name, with a plain fallback when signed out.

## Notes

Done 2026-09-06. Settings: "Your memories are kept on this Mac. Claude reads
them when it works with you here. Buyers only ever get what you approve for
sale." Approval hint: "Buyers only ever get what you approve here." Closed
deploy card: "everything else stays private." Memories tooltip: "Nothing
here is for sale unless you draft it and approve it."
