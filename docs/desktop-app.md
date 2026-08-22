# The Lore desktop app

Owner console for Lore. Buyers never need it — their agents call the deployed
MCP node. This document pins the decisions behind the `APP-001`–`APP-005`
backlog sequence so a build session does not re-derive them. The backlog items
under `docs/backlog/desktop-app/` are the work; this is the why and the
contracts.

## Why it exists

Non-technical owners cannot engage Lore through an agent runtime. Two real
users said it plainly: one could not get past the GitHub page ("I just opened
the GitHub but didn't know what to do from there"); the other described the
product he'd actually return to — "a place to go to see all their stuff…
Because it is pretty personal also so you want to be able to have eyes on it.
Can be super super simple. … It's like what I imagine a Shopify vendor sees.
Even simpler though maybe." Headless was the wrong ownership model: an
invisible memory system feels spooky; a visible library feels owned.

The governing principle: **agent-guided setup, Shopify-simple operation.** The
agent is still the interaction model; the app is the persistent place where
the resulting state becomes visible and owned. Chat is part of the app, not
the entire app. One loop done beautifully: *say what you know → see what Lore
made → approve what becomes sellable.*

## Shape

Three tabs — `[ Today ] [ My Lore ] [ Store ]` — plus one persistent capture
input. Town-style restraint: no email, calendar, tasks, or chief-of-staff
ambitions. Store shows truth (live / approved-not-live / drafts / revoked,
price, node link, drift warnings), not analytics; charts wait for real
transaction volume.

## Architecture

```
Electron renderer   sandboxed HTML/CSS; no Node, no fs; narrow typed IPC
Electron main       Pi Agent Core (persistent session) + subprocess calls
lore CLI (Python)   the only writer of SQLite; all validation lives here
Deployed node       CF Worker; unchanged; its own API-key secrets
```

Load-bearing rules, in priority order:

1. **The app never touches SQLite directly.** All reads come from the
   `APP-001` versioned-JSON snapshot; all writes go through `lore` CLI
   subcommands so the Python validation paths stay authoritative.
2. **Pi never gets a shell.** Its whole tool surface is four seams
   (`APP-004`): an allowlisted `lore_cli` tool, a scoped read-only file tool
   for agent-history import, the `ask_user` structured-question seam, and
   `load_skill` — the desktop equivalent of the agent-runtime Skill tool,
   needed because the owner skills route to each other (onboard → monetize,
   capture → publish, publish ↔ enable-payments).
3. **The agent cannot approve.** Approval cards are app-invoked UI routed to a
   dedicated CLI command excluded from Pi's allowlist — the desktop equivalent
   of the TTY-required approvals.
4. **Skills stay the source of truth.** `SKILL.md` loads verbatim as Pi's
   instructions; the app renders questions and progress. No parallel
   onboarding state machine — the setup checklist derives from the snapshot.
5. **Credentials never enter Lore state.** Provider credentials live in a
   `pi-ai` `CredentialStore` implemented over Electron `safeStorage`
   (Keychain); never in SQLite, renderer storage, logs, or job payloads.

## Inference auth

Resolved (was the largest open unknown): `pi-ai` already ships OAuth flows
for Anthropic (Claude Pro/Max) and OpenAI Codex (ChatGPT), with PKCE,
device-code, token refresh serialized inside the credential store. The app's
sign-in is therefore "Sign in with Claude / Sign in with ChatGPT", with a
pasted API key as fallback. Anthropic's guidance (verified Aug 2026) is that
supported third-party/Agent SDK usage draws from subscription limits.
Subscription credentials power only the owner's local attended agent. The
deployed node's answer path stays on API keys and keeps bypassing Pi's auth
layer — a personal subscription credential must never serve paying buyers.

## Runtime provisioning

The app bundles the `uv` binary plus a wheelhouse (lore-mcp, windup, deps —
wheeled at build time so no git needed) and provisions an app-owned toolchain
on first launch, with uv fetching its pinned managed Python. Details and
signing implications in `APP-005`.

## Sequence and gate

`APP-001` snapshot → `APP-002` read-only shell → `APP-003` embedded Pi +
capture → `APP-004` skills-driven setup and owner actions → `APP-005`
packaged macOS proof with a synthetic persona and a bounded testnet buyer
call. The checkpoint gate is after APP-003: if capture through the app does
not feel better than capture through Claude Code, the remaining desktop work
is premature. De-risking spikes that need no Electron: OAuth sign-in plus
Keychain round-trip in a bare main process, and each skill dry-run under Pi
with the exact `APP-004` tool surface in a terminal harness (`XC-005`).

## Still open (tracked, not blocking)

- Owner-authenticated read path to the deployed node (real revenue/orders in
  Store); snapshot marks live state unavailable until then.
- `MON-013` drift semantics feed the snapshot's local-vs-live states.
- Voice beyond native macOS dictation (Zane's podcast-style capture ritual).
- Menu-bar/global-shortcut quick capture (post-v0; copy Town's restraint).
- Zane's mockups for the four core frames: morning open, recording, reviewing
  extraction, updated storefront.
