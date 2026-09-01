---
id: APP-048
title: Let the owner rename a memory
priority: P2
effort: M
component: desktop-app
status: in-review
related: [APP-011, APP-037]
blockers: []
dependencies: []
github_issue: "https://github.com/dipakkrishnan/lore-mcp/issues/172"
created: 2026-09-01
updated: 2026-09-01
---

## Problem

APP-037 let owners edit a memory's content in place, but its title is stuck
at whatever synthesis first gave it. `lore/store.py` only exposes
`set_content`, and `lore memory edit` (`lore/cli.py`) only ever touches
content — there is no title-setting path anywhere in the store, CLI, or
desktop IPC layer. A memory that gets renamed to something clearer as the
owner's understanding of it changes has no way to reflect that short of
editing the database directly.

## Proposed approach

- Add a `set_title` method to the store alongside `set_content`.
- Extend `lore memory edit` (or add a sibling `--title` flag) to set the
  title, mirroring the existing `--stdin`/positional split for content.
- Add a `memory:rename` IPC handler (`app/desktop/src/main.cjs`,
  `state.cjs`) and a corresponding `preload.cjs` bridge call, following the
  same shape as `editMemory`/`memory:edit`.
- Surface a rename action on the memory sheet (opened per APP-011) next to
  the existing content-edit action from APP-037.

## Acceptance criteria

- [ ] An owner can rename a memory from the desktop memory sheet and see
      the new title reflected in the Memories list without a manual refresh
- [ ] `lore memory edit` can set a title from the CLI independent of
      content
- [ ] Renaming a memory does not touch its content, project, or timestamps
      beyond `updated_at`

## Notes

Cataloged from GitHub issue #172 ("Memories should be renamable").
