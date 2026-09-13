---
id: APP-115
title: Give Lore a mark that says what it is
priority: P3
effort: S
component: desktop-app
status: completed
related: [APP-107, APP-110]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-13
updated: 2026-09-13
---

## Problem

The mark shipping in v0.1.1 is two open arcs and a dot on a green tile. It
reads as a target or a loading spinner, shares its stroke style with the nav
icons beside it, and says nothing about memory, knowledge, or trade. Obsidian's
mark works because the stone and the faceted crystal explain each other
without a caption; Lore's had no metaphor to lean on.

## Proposed approach

Strata: a sliced stone with its bands showing. Lore accumulates, each memory
is a layer, and the older ones sit deeper. Picked on 2026-09-13 from four
directions drafted side by side (strata, ember, seal, spiral) at 192, 64, 32,
and 16 px on the app's own green and cream. One glyph in a 26-unit box, used
everywhere the mark appears: the app icon source, the sidebar brand, the
welcome screen, the owner card, and the site's mark and favicon.

## Acceptance criteria

- [x] `packaging/icon.svg` carries the strata glyph, so `icon.sh` builds the new `.icns`
- [x] The sidebar brand, welcome mark, and renderer's card mark use the same glyph
- [x] The site's mark and favicon match
- [x] The glyph still reads as layers at 16 px

## Notes

The bands could pass for water at a glance in the smallest sizes; flattening
the curves is the first thing to try if that bothers anyone.
