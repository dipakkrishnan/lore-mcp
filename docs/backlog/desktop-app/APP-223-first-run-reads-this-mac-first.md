---
id: APP-223
title: First run reads the apps on this Mac before asking for an agent
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-215, APP-222, XC-069]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-18
updated: 2026-10-18
---

## Problem

A new owner's first run asked which AI they talk to most, then sent a cloud
agent's owner to sign in to Cloudflare, before anything had come into Lore.
The apps already on this Mac were offered only while the agent was waited on.
The Cloudflare step also told the owner nothing about why it was needed. In dark
mode, the frosted sidebar picked up the dark material under a thin cream wash.

## Fix

- The first run starts with the apps it found on this Mac (Claude Code, Codex,
  Obsidian vaults): one tap connects them, or Not now. The chat says what came
  in once it's in, then asks which AI the owner talks to most. With nothing
  found, it asks straight away.
- A cloud agent (Grok Bot, ChatGPT, Claude) with no store online is asked
  "Want <agent> to save here too?", with why it needs a place online and a
  plain "Set it up". Claude Code or Codex, and None of these, end the first run
  on what the apps brought in, with no store step and no connect card.
- The last card counts what the agent saved and what the apps brought in, with
  See them and Go to Today.
- The sidebar is the light material in dark mode too, under a thicker cream
  wash.
