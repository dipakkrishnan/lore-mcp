---
id: CAP-022
title: Fill the folder reader gaps the vault corpus showed (quoted dates, odd titles, symlinks, path spellings, choices)
priority: P2
effort: S
component: capture
status: in-review
related: [CAP-004, APP-124, XC-051, CLI-010]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

Connecting the seed vault (12 found, 9 kept, 3 dropped, 4 excluded;
`tests/fixtures/live/obsidian/cli.jsonl`) exercised five behaviours that
exist only in that recording and not as tests: a single-quoted
front-matter date (obs-08, `date: '2026-09-14'`); a heading with `<>`,
an emoji and quotes surviving as the title (obs-05); a note that is one
long heading being kept on length alone (obs-09, a documented quirk);
a symlinked note being skipped (obs-16, `sources.py:213`); and
`sources choices obsidian --json` answering `[]` when the app never
registered the vault (F-obs-01). `test_sources.py` covers the `/` suffix
for folders (`:306`) but not `~` or `..`, and no Python test asserts the
`choices` CLI output shape.

## Proposed approach

Unit and component tests in the files that own the code; the seed vault
under `support/seed/corpus/obsidian-vault/Tidewell` is the fixture
(copied to the temp dir with `symlinks=True`).

### Files

- change `tests/test_sources.py`
- change `tests/test_cli.py` (choices output)

### Test design

1. `test_a_quoted_front_matter_date_parses` (obs-08): notes with
   `date: '2026-09-14'`, `date: "2026-09-14"`, `created: 2026-06-11`
   (no `date`), and `date: 14 Sep 2026` (unparseable → mtime fallback,
   `dated` is today's date) → `dated` as listed.
2. `test_a_heading_with_brackets_emoji_and_quotes_is_the_title` (obs-05):
   `# <Onboarding> 🐕 checklist & "quotes"` → `title` verbatim; also
   `test_a_note_without_a_heading_is_titled_from_its_file_name`
   (obs-04: `suds-and-buds.md` → `Suds And Buds`), if `:75` does not
   already assert the title-casing of a hyphenated name.
3. `test_a_long_heading_alone_passes_the_floor` (obs-09): a file whose
   whole content is a 60-character `# …` heading → kept, `content ==`
   the heading line; docstring says this is the documented quirk.
4. `test_a_symlinked_note_and_a_symlinked_folder_are_never_read`
   (obs-16): vault with `a.md` and `alias.md -> a.md`, plus `linked/ ->
   ../elsewhere/` containing `b.md` → `files()` yields only `a.md`; on a
   platform without symlinks (`os.symlink` raises), skip.
5. `test_every_spelling_of_a_folder_is_one_source`: `~/x`, `~/x/`,
   `~/x/../x`, and the absolute path → same `name()`; `label` is the
   folder name (`HOME` pointed at the temp dir).
6. `test_the_corpus_vault_reads_nine_and_excludes_the_four_rule_cases`:
   the seed vault → `found 12`, kept 9, dropped 3 (obs-10/11/12 by
   `keeps`), and `files()` never yields obs-13/14/15/16 paths (assert by
   path suffix); extends `test_sources.py:371`/`test_seed_tools.py:124`
   which check counts only.
7. `tests/test_cli.py::test_choices_prints_the_vaults_or_an_empty_list`:
   `OBSIDIAN_HOME` temp with an `obsidian.json` of two vaults, one `open`
   → `cli.main(["sources","choices","obsidian","--json"])` prints a list of
   `{label, locator, open}` with the open vault first; text form prints
   `  <label padded 20> <locator>` per line; with no `obsidian.json` →
   `[]` and exit 0 (F-obs-01).

## Acceptance criteria

- [ ] Tests 1-7 exist and pass; each names its manifest item id in its
      docstring.
- [ ] The symlink test is skipped, not failed, where symlinks cannot be
      created.
- [ ] `uv run python -m unittest discover -s tests` passes; ruff check,
      ruff format --check and mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-02 (quoted date, special title, heading-only quirk, skipped
dirs and symlink, path normalisation, `choices` CLI), C-02 `_day`, C-03
`keeps`, C-04, C-06, C-23 `choices`; F-obs-01, F-obs-02.

Flakiness/safety: mtime-dated cases assert "today" via
`date.today().isoformat()` computed in the test right before the read;
run within one process so midnight cannot split it (accept either today
or yesterday if it does).
