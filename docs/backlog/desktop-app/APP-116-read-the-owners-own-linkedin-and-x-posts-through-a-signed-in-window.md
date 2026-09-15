---
id: APP-116
title: Read the owner's own LinkedIn and X posts through a signed-in window
priority: P2
effort: L
component: desktop-app
status: in-review
related: [CAP-003, APP-056, XC-027, APP-048]
blockers: []
dependencies: ["A decision on the terms-of-service disclosure wording for LinkedIn and X"]
github_issue: null
created: 2026-09-14
updated: 2026-09-15
---

## Problem

LinkedIn offers no API path for a member's own posts and X charges the app
owner per read, so `CAP-003` can only seed from Substack and archive drops.
Requesting an archive is a two-visit task that arrives by email a day later,
which is "too much work" for the first session, in Dipak's words. The
owner's own posts are one signed-in page away in a browser they control.

## Proposed approach

An attended `read_posts` tool beside `open_url`: the card names the platform
and what will be read, the owner clicks Open, and main opens a child
`BrowserWindow` on a persistent `persist:lore-connect` partition pointed at
the owner's own activity page. The owner signs in inside that window once;
the cookie stays in Electron's partition on this Mac. Main then scrolls at a
human pace, extracts post text, date, and link through `executeJavaScript`,
skips reposts, and returns the posts to the agent, which hands them to the
`CAP-003` correction flow. The renderer stays sandboxed; nothing leaves the
machine. A spike (`read-posts.cjs`, Electron 43) proved the window, partition,
and signed-out detection on 2026-09-14; extraction selectors are unverified
against a signed-in page.

Disclose on the card, in the owner's words: "Lore reads your own posts in a
window you can see. Nothing leaves this Mac. LinkedIn and X do not allow
automated reading, so this is done slowly and once." Kernel (hosted browsers
with managed auth, about two cents per read) is the upgrade if scheduled
pulls are wanted later; it moves the login off the Mac and needs a Lore-owned
key broker, so it is out of scope here.

## Acceptance criteria

- [ ] From a fresh Lore, "Connect LinkedIn" opens a window, the owner signs
      in, and their own posts arrive as private memories without a terminal
      or an archive.
- [ ] The same for X by handle.
- [ ] A second run needs no sign-in, and Settings offers "Forget this login"
      which clears the partition.
- [ ] The card carries the disclosure and a failed read ends in a named
      state with the archive drop as the fallback.
- [ ] Selectors live in one table per platform so a layout change is a
      one-place fix.

## Notes

Alternatives weighed 2026-09-14: X's official MCP with an app-only bearer is
the least user effort (handle only) but bills Lore about $0.005 per post.
Instinct holds credentials on a cloud computer, which is the wrong posture;
Town avoids the problem by integrating only OAuth platforms. Detection risk is
lowest on the owner's real device and home IP, in a visible window.

2026-09-15, framing after reading the Codex harness. Lore's desktop agent is
Pi (pi-coding-agent 0.84.4: bash, read, write, edit, find, grep, ls) and has
no browser tool; Codex's browser exists only in the closed ChatGPT desktop
app and its Chrome extension, and the docs say "Browser isn't available in
Codex CLI or the Codex IDE extension", so nothing can be borrowed from
app-server. What the open-source Codex repo does carry is the policy shape
(`codex-rs/config/src/browser_use.rs`): a per-origin table with allow/deny
for access, downloads, uploads, and full CDP, an approval lifetime of turn
or thread, and a history-access flag; the browser itself is an MCP tool the
desktop host provides, with those policies passed as tool-call metadata.

So this item is not "add a browser". It is: give Pi the same host-provided
tool Codex's desktop app gives its model, with Codex's origin policy. Electron
main is the host; the child window on a persistent partition is the isolated
profile; `webContents.capturePage`, `webContents.debugger` (CDP in process,
accessibility tree via `Accessibility.getFullAXTree`), and `sendInputEvent`
are the observe/act primitives, so no Playwright dependency. Copy the policy
fields verbatim: access per origin (linkedin.com, x.com, substack.com),
downloads and uploads denied, full CDP off, approval per thread. A fixed
selector table does the read; the model-driven loop handles only what the
table cannot predict (a verification prompt, a layout change). OpenAI's
computer-use guide (Sep 2026) recommends the same observe/act loop with an
isolated browser, a site allow list, and step and cost limits.

Kernel (hosted browsers, Managed Auth) was trialled 2026-09-14 and stopped
before a password was typed: any hosted login passes the credential through
Kernel once, and credential saving defaults on. Kept as the option for
unattended scheduled pulls, not for the first version.
