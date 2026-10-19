---
id: APP-217
title: Connect Claude and ChatGPT by private link, and connect Grok Bot with one message
priority: P0
effort: M
component: desktop-app
status: in-review
related: [APP-207, XC-067, XC-068, APP-215]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-17
---

## Problem

Connectors offers Grok Bot, Muse, ChatGPT and Claude, but only Grok Bot gets
a working one-link setup. The other three get an address, a bearer header,
instructions and "Some apps can only connect through a sign-in, which Lore
doesn't offer yet", which reads as broken and still counts as connected. Our
Grok Bot steps ("Connect apps › Custom connector") are not what xAI
documents.

Primary sources (checked Oct 17, 2026) say:

- Claude (Free, Pro, Max, Team, Enterprise) adds a custom remote connector
  with "No sign in": Customize › Connectors › + Add › Add custom connector,
  name and URL, Continue, No sign in, Add. Free allows one custom connector.
  The URL must be public HTTPS, reachable from Anthropic's cloud.
- ChatGPT adds a custom MCP server with "No authentication": Plugins › + ›
  Add custom MCP server. Writes are documented for Business and
  Enterprise/Edu; Plus is unverified.
- Grok Bot's documented way to add a custom MCP server is to ask it in chat:
  "Add this MCP server: <url>". Grok Bot confirmed this itself (Oct 17): send
  it an https MCP URL and it adds it to the account; for OAuth services it
  uses automatic sign-up (DCR) when offered, else asks for a client id.
- Muse: no primary source for adding an arbitrary MCP URL.

## Proposed approach

- Claude and ChatGPT get the same private link as Grok Bot (`/agent/<key>`),
  with their own three-step path, Copy, and a live "Waiting for <agent>…".
- Grok Bot: Lore copies one message, "Add this MCP server to my account:
  <link>", to paste
  into Grok Bot's chat (Open Grok Bot when installed, APP-216). Keep the
  Connect apps path as a fallback line.
- Muse shows "Coming soon" and creates no key.
- Remove the address + header + instructions variant and the "sign-in
  coming" notice from the default flow.
- Each agent's sheet offers its routine as an optional next step (Grok Bot
  routines, Claude scheduled tasks, ChatGPT scheduled tasks): "Save what you
  learned today to Lore, every evening."

## Acceptance criteria

- [x] Claude, ChatGPT and Grok Bot each connect from one copied link or message.
- [x] Muse creates no key and does not count as connected.
- [ ] A live test with Claude (Free plan) and ChatGPT saves a memory through the link; record the plan used.
- [x] Steps and labels match the vendors' documentation as of the build date.

## Notes

Anthropic advises against credentials in URLs; the key in `/agent/<key>` is
revocable from Manage and scoped to write-only `store`, `stored`, `forget`.
Bearer headers (Claude limited beta) and OAuth (XC-068) remain the upgrade
path. XC-068 now signs Claude, ChatGPT and Grok Bot in at the plain `/agent`
address; this private link stays as the fallback.
