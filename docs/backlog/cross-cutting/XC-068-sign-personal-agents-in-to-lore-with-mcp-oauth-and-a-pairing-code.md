---
id: XC-068
title: Sign personal agents in to Lore with MCP OAuth and a pairing code
priority: P1
effort: L
component: cross-cutting
status: in-review
related: [XC-067, APP-207, APP-217, CAP-036]
blockers: [XC-067]
dependencies: [@cloudflare/workers-oauth-provider]
github_issue: null
created: 2026-10-16
updated: 2026-10-18
---

## Problem

grok.com custom connectors, Claude, ChatGPT and Muse connect to remote MCP
servers through MCP OAuth (OAuth 2.1, PKCE, dynamic client registration),
and several refuse a pasted bearer key. Today Lore puts a secret key in the
connector address (`/agent/<key>`, APP-217), which the makers advise
against. Owners have no Lore web account to sign in with, and we don't want
passwords.

## Proposed approach

The connector address becomes the plain store address with no secret in it:
`https://<store>/agent`. Cloudflare's `workers-oauth-provider` sits in front
of `/agent` (where agent writes live, not the buyer `/mcp`): protected
resource and authorization server metadata, dynamic client registration,
client metadata documents, PKCE and OAuth 2.1.

The authorize page has no login. It names the app asking and shows a short
code, and says "Approve on your Mac". Lore on the Mac already asks the store
what is waiting; it now also sees the sign-in and shows a card: "Claude wants
to save to your Lore", the same code, Allow or Deny. Allow makes the agent's
row exactly as a pasted key does and binds the sign-in to it; the browser
page then goes on by itself. The consent step uses the library's own consent
handle, so it works once, for ten minutes, in the browser that opened it.

Issued tokens carry one scope, `save`, for the same three write tools.
Refresh works. Disconnecting the agent in Connectors (or anything that
replaces its key) stops its access token at once and its refresh token at the
next refresh. A signed-in agent has no link to replace, so Manage offers only
Disconnect; to reconnect, the owner adds Lore in the app again.

The key-in-link path stays for agents connected before this and for any
agent that can't sign in ("Can't sign in? Use a private link instead", and
Other). The first-run chat still hands out a private link.

## Acceptance criteria

- [ ] Claude (custom connector, "Sign in now") and Grok Bot connect end to end with only the plain address and Allow on the Mac.
- [x] Sign-ins expire in 10 minutes, are single use, and are rate-limited; deny or expiry never binds.
- [x] Disconnecting the agent in the app makes its refresh and access tokens fail.
- [x] Pasted keys keep working.

## Notes

- The OAuth store is a KV namespace, `OAUTH_KV`, with no id in
  `wrangler.jsonc`: `wrangler deploy` makes it in the owner's account the
  first time. Check this on a throwaway account before the next release.
- Needs a live test with a throwaway Cloudflare account and real Claude and
  Grok Bot. Grok Bot said (Oct 17) it signs up automatically (DCR) for OAuth
  services when offered, so its message carries the plain address too; but a
  Grok connector has been reported marking itself connected without ever
  opening the authorize URL (ergofobe/imogen-server #27). Test against real
  Grok Bot before calling it done, and fall back to the private link if it
  never asks.
- ChatGPT's label for this is "OAuth"; confirm it on the build date.
