# Manual capture UX

Design notes for [issue #8](https://github.com/dipakkrishnan/lore-mcp/issues/8).

## What this covers

Every capture path built or planned so far starts inside an agent session:
`lore/sources.py` imports agent-generated memory files, and issue #6's design adds a
`SessionEnd` hook that distills a live Claude/Codex session into candidates. Neither
covers content that never touches an agent session at all — a PDF the owner already
has, a screenshot of a whiteboard, or a preference they want to jot down directly
without opening an agent.

Two ingestion patterns fill that gap:

1. **Intake dropbox** — a watched folder the owner drops files into; Lore processes
   them automatically.
2. **Textual intake** — a CLI interface the owner types or pastes into directly,
   optionally attaching one small file from a limited allow-list.

## This is a capture source, not a new system

Issue #6 already separated the pipeline into three decisions — capture, retention,
disclosure — and proposed a `captures` table, structurally unreachable from `answer`,
as the landing zone for anything not yet distilled into a reviewed memory. Both
patterns here are new *sources* feeding that same table, following the existing
`Source` / `scan()` abstraction (`lore/sources.py:12-55`) and the same fingerprint-based
dedup `store.put()` already performs (`lore/store.py:99-147`).

Building these as a parallel staging mechanism would duplicate the review, promotion
(`lore add`), and discovery-digest machinery issue #6 already designed. Building them
as sources means that machinery is shared automatically.

**Dependency:** the `captures` table is step 2 of issue #6's sequence and does not
exist on `main` yet. This design assumes it lands first; the two patterns below are
naturally sequenced right after it, not before.

## Shared plumbing

- **One extraction module**, not two. `lore/extract.py` takes a path or raw bytes plus
  a declared type and returns extractable text or `None`. Both the dropbox scanner and
  the `--file` attachment flag call the same function, so file-type support is added
  once and both patterns benefit.
- **No resident process.** Lore does not stay running (README: "Lore does not stay
  resident or own the recurring schedule"). Both patterns are pull-based: driven by
  `lore sync` / a new scan call, and optionally by the same native-scheduler cadence
  `automation.py` already installs. Neither pattern introduces a filesystem watcher
  daemon.
- **Same dedup discipline.** Re-scanning a file already captured is a no-op, using the
  identical sha256-fingerprint + `source_key` pattern `sources.py` uses today.
- **Never on the paid surface.** Issue #6's design notes already flag the trap of
  wiring capture into `lore serve` via `mcp_tool` hooks — that server is the public,
  paid surface intended to sit behind the Cloudflare tunnel. Both patterns here stay on
  the CLI/stdio side, same as planned for `lore capture --stdin`.

## Pattern 1: intake dropbox

A watched folder, `~/.lore/inbox/`, mirroring the `~/.lore/memories/<agent>/`
convention already used for synthesis output. Scanned like any other source, on
`lore sync` or the native schedule.

### Type dispatch is the real fork

- **txt / md / csv / json** — read directly. Zero new dependencies, ships
  immediately, matches the project's stdlib-only principle (README: "no application
  framework, vector database, or MCP SDK to install").
- **PDF / docx / images** — need real extraction, and stdlib cannot do it. This is an
  explicit decision point, not something to default past:
  - take a narrow, optional dependency (e.g. `lore[files]` extra shipping `pypdf`), or
  - shell out to OS tools already available (`pdftotext`, macOS `textutil`) — the same
    subprocess pattern `automation.py` already uses to talk to agent CLIs, at the cost
    of platform-dependent behavior.
  - Recommendation: ship txt/md/csv/json first, decide the dependency question as a
    fast-follow once real dropbox usage shows which file types actually show up.
- **Unsupported / unextractable files** still get a capture row — filename, size, MIME
  type — with no indexed content, so they're visible in review as "not indexed" rather
  than silently dropped.

### After processing

Move the file to `inbox/processed/`, don't delete it. These are files the owner
physically placed there; auto-deleting them is a destructive default with no upside.
Archiving is reversible and costs nothing. Re-running the scan against an archived
file is already a no-op via fingerprint dedup, so nothing needs to track "already
processed" separately from the content hash.

## Pattern 2: textual intake

This is the `lore capture` command already named in issue #6's sequence
("Add the `captures` table and `lore capture --stdin`") — one command, not two
competing entry points.

- `lore capture` — multiline input via `$EDITOR` or stdin until EOF, same interaction
  shape as `git commit -e`.
- `lore capture "quick note"` — one-line form for a single thought.
- `lore capture --file <path>` — attaches one small file, subject to the same
  allow-list and size cap as the dropbox, routed through the same `lore/extract.py`.

### Open question: does typed input skip the staging tier?

Dropped files and session transcripts are raw material — nobody has looked at them
yet, so they belong in `captures` pending distillation. A note the owner deliberately
typed ("I prefer X because Y") is arguably already claim-shaped and low-volume by
construction.

Two options:

- **Uniform model (recommended default):** everything enters via `captures`,
  `lore add "<description>"` promotes to `memories` regardless of origin. One mental
  model, one code path, consistent with treating `captures` as "not yet distilled"
  rather than "not yet reviewed."
- **Fast path:** typed notes land directly in `memories` as `pending`, subject to
  today's ordinary `lore review`. Lower friction for the most deliberate input, at the
  cost of a second on-ramp into the review queue that behaves differently from every
  other source.

Recommend starting with the uniform model and revisiting only if real usage shows the
extra `lore add` step is friction for short deliberate notes specifically.

## Sequence

1. Land the `captures` table (issue #6, step 2) — hard dependency for both patterns.
2. Add `lore/extract.py` covering txt/md/csv/json only.
3. Add `lore capture` (stdin / one-line / `--file`), landing in `captures`.
4. Add the `~/.lore/inbox/` scanner as a new `Source`, reusing `lore/extract.py`.
5. Decide the PDF/docx/image extraction dependency question once dropbox usage shows
   which types actually show up.

## Open questions

- Size cap for `--file` attachments and dropbox files — needs an explicit default
  (likely low single-digit MB), configurable via `store.set_setting`.
- Whether `~/.lore/inbox/` should be configurable independently of `LORE_HOME`, for
  owners who want the dropbox on a synced drive but the database elsewhere.
- Retention policy for `inbox/processed/` — keep forever, or age out after some period.
- Whether the fast-path question above should be revisited once `lore add` promotion
  actually exists and its friction can be felt directly instead of guessed at.
