---
id: APP-207
title: Connect a personal agent and hear when it saves something
priority: P0
effort: M
component: desktop-app
status: in-progress
related: [XC-067, CAP-036, CAP-037, AUT-005]
blockers: [CAP-036]
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/467
created: 2026-10-16
updated: 2026-10-16
---

## Problem

Owners manage everything in the app. Connecting Grok or Muse has to work
like connecting any other app, and the owner must hear when their agent
saves something. Otherwise the write path is invisible and the loop that
turns saves into memories, and memories into pieces for sale, never closes.

## Proposed approach

- **Connectors tab.** Add a "Your agents" group. Each connected agent is a
  row with its logo, "Saved 12 · last today", and Manage (Get a new key,
  Disconnect: keep or delete memories). "Connect an agent" opens a sheet:
  - Pick Grok, Muse, ChatGPT, Claude or Other.
  - The sheet shows the steps for that app (Grok Bot: Settings → Plugins →
    add a custom connector), with copy buttons for the address, the key
    header and the instructions (CAP-037), plus "Copy all".
  - The sheet then waits: "Waiting for Grok's first save…". It turns into
    "Grok saved its first memory" when one lands.
- **Loop back.** A watch like `watchSales`: every 60 s and on window focus,
  `lore agents waiting --json`. When something is waiting, read those agent
  sources through the reading path (AUT-005), so the saves become topic
  memories with the "worth selling" flag. The owner gets a Mac notification
  ("Grok saved 3 things to Lore") plus the red dock badge, and the Today
  "New memories" card shows them, named by what they're about.
- **Provenance in the UI.** A memory from an agent says "From Grok". Agent
  sources show in the snapshot by app, not by source name.
- Copy is plain and non-technical: "key" not "token", no "MCP" in the main
  text (the address field can say it).

## Acceptance criteria

- [ ] Connect an agent → the sheet shows a working address, key and instructions that can be copied, for each of the five choices.
- [ ] A save made with that key reaches the app within a minute while it is open, becomes memories, posts one notification, and raises the badge.
- [ ] Manage → Get a new key revokes the old key; Disconnect revokes it and keeps or deletes its memories as chosen.
- [ ] Offline or signed out of nothing: the watch fails quietly and retries; it never blocks the UI.
- [ ] An edge scenario (`support/edge.sh agents`) drives connect, a stand-in save, the notification and the Today card, and is in `test:edge`.

## Notes

- Muse connector setup comes after Grok. The sheet lists Muse now, with its
  own steps, but the hero demo is Grok Bot.
