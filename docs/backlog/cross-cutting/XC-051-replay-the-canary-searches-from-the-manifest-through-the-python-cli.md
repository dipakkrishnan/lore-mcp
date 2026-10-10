---
id: XC-051
title: Replay the manifest's canary searches through the Python CLI in a throwaway home
priority: P1
effort: M
component: cross-cutting
status: in-review
related: [XC-048, XC-050, CLI-010, CLI-002, CAP-022, CAP-021, CAP-018]
blockers: [XC-048]
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The seed corpus gives every item exactly one canary token
(`canary-<connector>-<nn>`) and an `expected` of `kept | dropped |
excluded`, so kept-vs-dropped can be asserted symmetrically: kept → one
search hit from the expected source, dropped/excluded → `[]`. That proof
was run by hand and pasted into `tests/fixtures/live/**/cli.jsonl`, but no
test performs it (F-xc-01). Consequently nothing asserts that a hit's
`source` is the seed source, that `cg-91` (the regenerated ChatGPT
branch) never imports, that `obs-13..16` (templates, `.trash`,
`.obsidian`, symlink) never import, or that `bl-05`'s `<script>` text is
absent from the memory. `tests/test_seed_tools.py:124` checks counts
(9/3) only.

## Proposed approach

One e2e file that drives `lore.cli.main` for every connector provable
offline, then walks `manifest.json["items"]` and searches each canary.

### Files

- add `tests/test_e2e_canaries.py`
- (no change to `support/seed/` or `lore/`)

### Fixtures and stand-ins

| connector | how it is connected in the test | manifest counts |
|---|---|---|
| obsidian | copy `support/seed/corpus/obsidian-vault/Tidewell` to the temp dir (`shutil.copytree(symlinks=True)`), `cli.main(["sources","connect","obsidian",path,"--json"])` | found 12 / kept 9 / dropped 3 |
| chatgpt | `build_exports.build(tmp)` (as `test_seed_tools.py:108` does) → `connect chatgpt <zip>` | 5 / 4 / 1 |
| claude | same → `connect claude <zip>` | 4 / 2 / 2 |
| blog | `support/seed/corpus/blog` on `ThreadingHTTPServer` at `127.0.0.1:0` → `connect blog http://127.0.0.1:<port>` | 6 / 5 / 1 |

Substack/Medium/Bluesky/Notion/Granola have no offline source of truth
for the whole corpus (their recordings are `CAP-018`/`CAP-019`/`CAP-016`'s
contract tests, and their real accounts are `XC-054`'s live suite), so
this item covers the four above and asserts the manifest's
`expected.kept` for them, not `observed`.

### Test design

1. `setUp`: `LoreTestCase` (temp `LORE_HOME`); connect the four sources;
   keep the returned `name` per connector.
2. `test_every_connect_reports_the_manifest_counts`: for each of the
   four, the connect row's `imported` equals
   `manifest["sources"][c]["expected"]["kept"]` and `state == "connected"`.
3. `test_every_canary_is_kept_or_absent_as_the_manifest_says`: for each
   item with a `canary` and `connector` in the four: run
   `cli.main(["search", canary, "--json"])` under `captured()`; parse the
   JSON list. `expected == "kept"` → exactly one hit and
   `hit["source"] == name[c]`; `dropped`/`excluded` → `[]`. Items with
   `canary: null` (obs-10/11/12, bl-06) are asserted through their title:
   `search "<title words>" --json --source <name>` returns `[]`.
4. `test_the_regenerated_branch_and_the_skipped_folders_never_import`:
   explicit assertions for `canary-chatgpt-91`, `canary-obsidian-13`,
   `-14`, `-15` → `[]`, and that no memory content from the obsidian
   source contains `alias-sms-timing` (obs-16, symlink).
5. `test_silenced_and_fallback_bodies`: the bl-05 hit's `content` does not
   contain `<script>` text or the CSS from the `<style>` block (read the
   corpus file to get the exact strings); the bl-04 hit's content equals
   the description text; bl-03's title is
   `Routes & ramps: <van> life 🚐` (entities decoded).
6. `test_titles_and_dates_survive_the_round_trip`: obs-05 title verbatim
   (`<Onboarding> 🐕 checklist & "quotes"`), obs-03 `dated == 2026-06-11`
   (`created:` fallback), obs-08 `dated == 2026-09-14` (quoted), cg-05
   undated, cg-02 content ends with a 600-char `Reply:`.
7. `test_reading_again_changes_nothing`: `cli.main(["sources","read",
   name,"--json"])` for each → `added 0, updated 0, unchanged == kept`.

All searches use `--json`; search terms are `[\w-]+` tokens AND-joined, so
`canary-blog-01` matches only that token sequence (verified in
`lore/cli.py` search).

## Acceptance criteria

- [ ] `tests/test_e2e_canaries.py` connects obsidian, chatgpt, claude and
      blog through `cli.main` in a temp `LORE_HOME` and asserts every
      manifest canary for those connectors (kept → 1 hit from the seed
      source, dropped/excluded → `[]`).
- [ ] Counts asserted equal `manifest.json` `expected` (12/9/3, 5/4/1,
      4/2/2, 6/5/1); a deliberate corpus edit that pushes `bl-06` over
      40 characters makes the test fail.
- [ ] The test never reads `~/.lore`, never opens a network socket other
      than `127.0.0.1`, and leaves no files outside its temp dir.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-02 (canary proof, secret-not-detected is `XC-052`), W-03 and
W-04 (canary rows), W-08 (`connect blog` + canary replay), W-14
(re-read unchanged, e2e), W-25 (the offline half of "canary kept/dropped
symmetry"), C-19 `_import`, C-23 `connect`/`read`, C-25 search; F-xc-01.

Flakiness/safety: obs-04/obs-09 are dated by mtime of the copy, so assert
`dated is not None` rather than a value; the blog server binds port 0.
The symlink `obs-16` must be copied as a symlink (`symlinks=True`) or the
excluded case silently becomes a duplicate kept note.

Sequencing: blocked by `XC-048` (file prefix). `CLI-010` covers the
JSON/text shapes of the same commands; this item covers what lands in the
store.
