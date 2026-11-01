---
id: CLI-011
title: Drive `sources read`, `remove`, `preview`, `add` and `sync` through `cli.main`, and check `desktop-state` after each
priority: P2
effort: S
component: cli-ux
status: in-review
related: [CLI-010, CLI-002, XC-048, CAP-026, CAP-027, APP-001]
blockers: [XC-048]
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The lifecycle after connect — `read` (desktop "Read again"), `remove
--keep|--delete` (Disconnect), `preview`, generic `add`, and `sync`
picking up owner sources — is tested per command in scattered places
(`test_export.py:252`, `test_feed.py:376`, `test_cli.py:485/573/584`) but
never as the sequence an owner runs, and never with `lore desktop-state`
checked between steps to see what the app would show (`snapshot.py:205-258`
prints `Registry.entries()` verbatim, `sources_configured` at `:242`).
`CLI-002` chains the owner CLI but its chain has no owner source in it.

## Proposed approach

One e2e file continuing `CLI-010`'s stand-ins.

### Files

- add `tests/test_e2e_sources_lifecycle.py`

### Test design (one class, one temp home, steps in order)

1. `desktop-state --json` before anything: `library.sources` has no
   `connector` rows, `setup.sources_configured` is False (or whatever
   `:242` computes for built-ins only — assert the value and say why).
2. `add --folder <vault> --connector obsidian --label Mine --since
   2026-01-01 --json` → `label "Mine"`, `name` starts `obsidian-`; a note
   dated before the day is not imported; `add --folder x --connector
   substack` → exit 2 (kind/connector mismatch); `--since "last tuesday"`
   → exit 2 before anything is stored (`sources list --json` unchanged).
3. `preview --feed <url> --json` → `{label, count, from, to, skipped,
   state}`; text form `N to import · M too short · connected`; nothing
   added.
4. `read <name> --json` → `[{name, added 0, updated 0, unchanged N,
   errors 0, state}]`; text form `  <name padded> 0 added, 0 updated, N
   unchanged · connected`; `read` with no names reads every owned source;
   `read nope` → exit 2 `lore: …`.
5. Edit one note → `read` → `updated 1`; `desktop-state` row's
   `last_read_at` advanced and `imported` unchanged.
6. `sync` → its output names the owner source (extends `test_cli.py:573`)
   and the export source is reported `unchanged`.
7. `remove <name> --keep --json` → `{name, removed: true, memories:
   {kept: N}}`; `desktop-state` no longer lists it; memories still
   searchable; `remove <name> --delete` on a second source → `memories:
   {deleted: N}` (`kept` count for any cited memory: seed one publication
   citing a memory first, as `test_sources.py:346` does); `remove claude`
   (built-in) → exit 2; `remove gone` → exit 2.
8. `desktop-state --json` output contains no ANSI escape and no line
   before the JSON (the desktop parses stdout whole).

## Acceptance criteria

- [ ] `tests/test_e2e_sources_lifecycle.py` runs steps 1-8 in order in one
      temp `LORE_HOME` through `cli.main`, asserting JSON keys exactly and
      text lines by equality.
- [ ] `desktop-state` is checked after add, read, and remove.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-12 (CLI preview text and `--json`), W-13 (`add` flags,
mismatch, `--since` validation, `--label`), W-14 (`read` JSON/text,
`sync` includes owner sources), W-16 (CLI JSON `{name, removed,
memories}`, built-in/unknown refused), W-20 (`entries()` fields,
subprocess JSON contract, `sources_configured`), C-02, C-19, C-23, C-24.

Flakiness/safety: in-process; `desktop-state` is invoked through
`cli.main` too (it is a CLI command), not a subprocess; `CLI-002` remains
the subprocess precedent.
