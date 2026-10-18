---
id: APP-215
title: First run: a short chat that connects the owner's agent, then their apps
priority: P0
effort: L
component: desktop-app
status: ready
related: [APP-207, APP-212, APP-214, XC-068]
blockers: [APP-212, APP-214, APP-216, XC-069]
dependencies: []
github_issue: null
created: 2026-10-17
updated: 2026-10-17
---

## Problem

After sign-in a new owner lands on a dashboard with about seven things to do
and no first step. The setup chat that exists is built for Claude Code and
Codex users (memory files, a "shape", a schedule). Grok Bot shows the better
pattern: it starts onboarding the moment it opens, one question at a time.

## Proposed approach

Right after sign-in Lore opens the chat and speaks first. The goal is the
owner's agent connected in two answers, then their apps.

1. "Hi <name>. I'm Lore. I keep what you've learned and help you sell the
   parts worth paying for. Which AI do you talk to most?" Choices: Grok Bot,
   Muse, ChatGPT, Claude, Claude Code or Codex, None of these. Agents
   installed on this Mac (for example /Applications/Grok Bot.app) come
   first, and if exactly one is found it is already picked (APP-216).
2. The connect card appears in the chat: the link, Copy, Open <agent>, and a
   live "Waiting for <agent>…". If the store isn't online, putting it
   online comes first, in the same card, with only the Cloudflare sign-in
   (XC-069: no price, payout or piece needed to receive saves).
3. While waiting, Lore offers the apps it found on this Mac without asking
   (Obsidian vaults via `choices()`; Claude Code and Codex memory via
   `available_sources()`, connected with `sources:switch` + `sources:read`), plus the ones that need a file or address (ChatGPT or
   Claude export, Substack). One tap connects the selected ones.
4. When the first save arrives: "Grok Bot saved 3 memories" with titles and
   marks, and See them (APP-212), which lands on Inventory filtered to that agent.

The waiting is the app's, not the model's: the chat turn ends once the card
is shown, so synthesis can run when the save lands. First-run state
(started, skipped, done) persists so a relaunch resumes it. The greeting uses
the owner's name only if Lore knows it.

The onboarding skill and the agent's system prompt change too: blueprint,
profile and rhythm come after the first save, not before.

"Skip for now" is always there. The shape, rhythm and pricing questions wait
for the evening check-in or are worked out from what came in. "Claude Code
or Codex" runs today's setup; "None of these" goes to the capture bar. The
two first-run notices become one quiet line in the chat.

## Acceptance criteria

- [ ] A fresh owner who picks Grok Bot sees the connect link within two answers of signing in.
- [ ] An installed agent app is detected and offered first.
- [ ] Found apps are offered while waiting, and connecting them takes one tap.
- [ ] The first save shows in the chat with See them.
- [ ] Skip for now lands on Today with the one next step (APP-214).
