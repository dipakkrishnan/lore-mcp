---
id: CAP-009
title: Connect apps through their hosted MCP servers
priority: P1
effort: L
component: capture
status: ready
related: [STO-003, CAP-003]
blockers: []
dependencies: ["CAP-003 connect → publish path merged first"]
github_issue: null
created: 2026-09-27
updated: 2026-09-27
---

## Problem

The apps where operators and consultants actually keep their thinking
(Notion, meeting notes, highlights) have no feed or export Lore can read.
Most of them now run an official hosted MCP server that any desktop client
can sign in to, the way Claude Code and Codex do. Lore can't use them.

## Proposed approach

One new reader kind, `mcp`, on the Python side using the official MCP
Python SDK (`mcp.client.auth.OAuthClientProvider`): loopback redirect on
`127.0.0.1`, tokens in the macOS Keychain via `keyring`. The desktop only
opens the sign-in URL and shows "Sign in to <app>". Transport, auth, paging
and import are shared; each `Connector` subclass declares its server URL,
its list tool, its read tool and the argument mapping, so one subclass is
still the whole registration. Imports stay incremental.

Ship first, all with dynamic client registration:
1. Granola — `mcp.granola.ai/mcp`, `list_meetings` then `get_meetings`.
2. Notion — `mcp.notion.com/mcp`, `notion-search` then `notion-fetch` (30/min).
3. Readwise — `mcp2.readwise.io/mcp`.

Next: Fathom/Fireflies, Linear, Atlassian, Dropbox. Not via MCP for now:
Google (developer preview, own GCP client, security review), Slack
(directory apps only), Microsoft 365, Zoom, Figma.

## Acceptance criteria

- [ ] `kind = "mcp"` reader with shared OAuth, Keychain token store and paging
- [ ] Granola, Notion and Readwise connectors, one subclass + one mark each
- [ ] A renamed or missing server tool shows as that connector's failure state, never silently
- [ ] Refresh is incremental; no full re-pull on every sync
- [ ] Edge scenario against a stub MCP server; no network in tests

## Notes

Research Sep 27 2026: 9 of the top 15 apps are reachable by a third-party
desktop client today with no partner approval. Risks: client allowlists
(Notion Enterprise, Atlassian admins), DCR withdrawn (Asana V2), plan
gating (Granola transcripts paid, free = 30 days), vendor terms on bulk
reads. Pi's `pi-mcp-adapter` could let the agent call these live later,
but it brings a second token store; importing is the primary path.
