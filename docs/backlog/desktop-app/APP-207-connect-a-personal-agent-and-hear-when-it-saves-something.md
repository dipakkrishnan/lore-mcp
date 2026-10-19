---
id: APP-207
title: Connect a personal agent and hear when it saves something
priority: P0
effort: M
component: desktop-app
status: in-review
related: [XC-067, CAP-036, CAP-037, AUT-005]
blockers: [CAP-036]
dependencies: []
github_issue: https://github.com/dipakkrishnan/lore-mcp/issues/467
created: 2026-10-16
updated: 2026-10-19
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
  - With no store online yet, the first step is putting it online: the same
    Cloudflare sign-in and deploy the store already uses, framed as "Your
    agents write to your own store, so it needs to be online." Nothing is
    for sale until the owner approves a piece.
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

- [ ] With no store online, Connect an agent puts it online first, then continues to the setup without starting over.
- [ ] Connect an agent → the sheet shows a working address, key and instructions that can be copied, for each of the five choices.
- [ ] A save made with that key reaches the app within a minute while it is open, becomes memories, posts one notification, and raises the badge.
- [ ] Manage → Get a new key revokes the old key; Disconnect revokes it and keeps or deletes its memories as chosen.
- [ ] Offline or signed out of nothing: the watch fails quietly and retries; it never blocks the UI.
- [ ] An edge scenario (`support/edge.sh agents`) drives connect, a stand-in save, the notification and the Today card, and is in `test:edge`.

## Notes

- Muse connector setup comes after Grok. The sheet lists Muse now, with its
  own steps, but the hero demo is Grok Bot.
- Built (Oct 16):
  - Connectors has a "Your agents" group: each agent with its mark (new
    `grok`, `muse` and `agent` marks; ChatGPT and Claude reuse theirs),
    "Saved N · last today" from `lore agents list`, and Manage (Get a new
    key, Disconnect: keep or delete). The catalog's generic "Personal agent"
    row is hidden.
  - Connect an agent is one sheet (`AgentSetup` in renderer.js). With no
    store online, its first step says why and starts the store's own deploy
    thread; once the store is online and that thread has finished, Lore
    returns to Connectors and the sheet opens at its next step. The deploy is
    an agent conversation with its own cards, so it can't run inside a modal
    sheet. Then the five choices and an optional name, then the steps for
    that app with Copy for the address, the key and the instructions, plus
    Copy all. The key is shown once, and the sheet waits for the first save.
    The sheet asks the store every 10 s while it is open.
  - `src/agents.cjs` `Watch`: every 60 s, on focus and at launch, only once
    the node's wrangler exists, `lore agents waiting --json`, then each
    agent read through the usual path. Checks never overlap, and failures
    are silent. `reading.worthReading` names an agent's reading after the
    agent ("Grok saved 3 things to Lore"), and the run carries `from`.
  - Provenance: an agent's raw memories take its name as their project
    (`lore/sources.py`), and Memories, the memory sheet and Today's New
    memories rows say "From Grok".
  - The desktop agent no longer loads `lore-store` (`ownSkills`). Its
    description invites "save that to Lore", which would compete with
    lore-capture through a `store` tool the local agent never has.
  - Edge: `support/edge.sh agents` runs the `tests/fixtures/inbox.py`
    stand-in (D1, `/agent`, a wrangler shim) with a file keyring
    (`tests.fixtures.inbox.Keyring`), so the owner's Keychain is never
    touched. It is in `test:edge` and CI.
- Not checked against a real Cloudflare account, the real Worker, or a real
  Grok, Muse, ChatGPT or Claude connector. The per-app steps for anything but
  Grok are generic.

**Review 2026-10-19:** not completed. Shipped in 347769b but largely superseded by APP-217 (2ea1c94): the sheet no longer shows address, key and instructions for each choice. Criteria need rewriting to match APP-217; confirm the watch interval is within a minute.
