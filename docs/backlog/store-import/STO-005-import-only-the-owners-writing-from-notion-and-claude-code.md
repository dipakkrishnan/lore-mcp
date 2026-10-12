---
id: STO-005
title: Import only the owner's writing from Notion and Claude Code
priority: P1
effort: S
component: store-import
status: in-review
related: [STO-004]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-06
updated: 2026-10-06
---

## Problem

Every Notion memory began with the fetch tool's preamble ("Here is the
result of "fetch" for the Page with URL …"), the page's properties JSON and
its icon JSON, because only the tags were stripped. Notion databases were
imported as their view lists and tool instructions. Claude Code's
`MEMORY.md` index (a list of links to the memories beside it) was imported
as six memories titled "Memory".

## Proposed approach

- Keep a Notion page's `<content>`; without one, drop the metadata
  elements, the preamble and leading JSON lines. `notion_writing` also cleans
  pages stored before this fix.
- Skip a Notion database (no writing) and any hosted item whose text is empty.
- Skip Claude Code's `MEMORY.md` the way synthesis skips its `INDEX.md`.

## Acceptance criteria

- [x] A Notion page imports as its own writing only.
- [x] A Notion database imports nothing.
- [x] Claude Code's memory index is not a memory.

## Notes

Pages already imported are not re-read, so existing libraries are cleaned
once with `notion_writing` (done for the owner's library on 2026-10-06).
