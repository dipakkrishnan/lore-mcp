---
id: APP-125
title: Make Connectors a first-class tab
priority: P1
effort: S
component: desktop-app
status: completed
related: [APP-120, APP-124, APP-122, STO-003, CAP-005, CAP-006]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-18
updated: 2026-09-18
---

## Problem

"Where memories come from" ships as a Settings section (`APP-120`), where
it is the longest thing on the page and sits under Account. Everything else
in Settings is set once; sources are used continuously, carry live state
and counts, and getting context into Lore is the job that matters most for
a new owner. A section under Settings says "preference"; the owner reads it
as first class. Dipak, 2026-09-18, on seeing `#309` live: "I view it as
first class, so let's put it there."

## Proposed approach

A `Connectors` view in the sidebar between For Sale and Settings, drawn from
the same catalog rows (`sourceRows`) with nothing new to render: the agent
rows (Codex, Claude Code) first with their own marks, then every app in the
catalog, then the schedule row, since it is how often Lore reads them.
Settings keeps Account, What Lore keeps, and Your store. The sidebar count
is connected sources. The word is "Connectors" because ChatGPT and Claude
both call this that now, so it is the one product word an owner already
knows. Today's first-source nudge and the account menu's "Open Settings"
stay; the nudge points at the new tab. The `obsidian` and `connectors`
edge scenarios open the tab instead of Settings.

## Acceptance criteria

- [x] A Connectors entry in the sidebar, with a mark and a count of
      connected sources, opens a view whose rows are the agents, every
      catalog app, and the schedule; Settings no longer shows them.
- [x] Codex and Claude Code rows carry the OpenAI and Claude marks.
- [x] `support/edge.sh obsidian` and `support/edge.sh connectors` pass
      against the tab; the palette and ⌘-number navigation, if any, include it.

## Notes

Built 2026-09-18 straight from in-review at Dipak's ask ("file it, and
build it"). The rows are the same `sourceRows` the Settings section drew;
Settings lost the section and nothing else. The `jobs` edge scenario now
reads the schedule row from the tab. There is no palette or ⌘-number view
navigation to extend.

Supersedes the placement decided in the Sep 16 research ("a Settings
section, not a tab"), which predates the surface existing.
