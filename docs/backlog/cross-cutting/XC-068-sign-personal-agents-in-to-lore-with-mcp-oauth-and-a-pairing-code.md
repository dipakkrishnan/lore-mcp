---
id: XC-068
title: Sign personal agents in to Lore with MCP OAuth and a pairing code
priority: P1
effort: L
component: cross-cutting
status: in-review
related: [XC-067, APP-207, CAP-036]
blockers: [XC-067]
dependencies: [@cloudflare/workers-oauth-provider]
github_issue: null
created: 2026-10-16
updated: 2026-10-19
---

## Problem

grok.com custom connectors, Claude, ChatGPT and Muse connect to remote MCP
servers through MCP OAuth (OAuth 2.1, PKCE, dynamic client registration),
and several refuse a pasted bearer key. Owners have no Lore web account to
sign in with, and we don't want passwords.

## Proposed approach

Put Cloudflare's `workers-oauth-provider` in front of the inbox's `/mcp`
(protected-resource and authorization-server metadata, DCR, PKCE).

The authorize page has no login. It shows a short pairing code ("LORE-4F7Q")
and the requesting app's name. The owner types the code into Lore on their
Mac (Connectors → Connect an agent → "I have a code"). The app sends it with
the owner token, and the page continues by itself. Then the provider issues
an access token bound to that owner and a new agent row, just like a pasted
key. Revoking from the app revokes the grant.

## Acceptance criteria

- [ ] Claude (custom connector) and grok.com connect end to end with only the pairing code.
- [ ] Codes expire in 10 minutes, are single-use, and are rate-limited; a wrong code never binds.
- [ ] Revoking the agent in the app makes its refresh and access tokens fail.

## Notes

- Live test notes: a Grok connector has been reported marking itself
  connected without ever opening the authorize URL (ergofobe/imogen-server
  #27). Test against real Grok before calling it done.

**Review 2026-10-19:** not completed. Not done. `/agent` only returns a 401 with an oauth-protected-resource header; no authorize/token/refresh endpoints, pairing code, expiry, rate limit or token revocation. All 3 criteria unmet; needs an external client to verify.
