---
id: APP-179
title: Serve the recorded Bluesky and Notion answers to the connectors edge scenario and assert the seed counts and odd titles
priority: P2
effort: M
component: desktop-app
status: in-review
related: [XC-050, APP-178, APP-125, APP-122, CAP-017, CAP-019]
blockers: [XC-050]
dependencies: []
github_issue: null
created: 2026-09-30
updated: 2026-09-30
---

## Problem

The desktop's `connectors` walk (`app/desktop/support/edge.cjs`) drives
Obsidian, ChatGPT, Substack, Medium and Blog from hand-trimmed fixtures
and Granola from the invented stub; Bluesky is only refused in-sheet
(`:379-382`) and Notion is never connected in the app at all. So the
renderer has never drawn a real Bluesky row (`@handle` label when the
display name is empty, R-08), a Notion row with 20-odd pages, a title with
`<>` and an emoji from a hosted app (nt-04, `<Roadmap> 🗺️ & priorities`),
or a "N pages kept" count taken from a recording. The recordings and
`XC-050`'s replay module make that possible without a network.

## Proposed approach

### Files

- change `app/desktop/support/edge.sh` (connectors branch): start
  `uv run python tests/fixtures/replay.py notion PORT` and export
  `LORE_NOTION_SERVER=http://127.0.0.1:PORT/mcp`; serve
  `tests/fixtures/live/bluesky/01-app-bsky-feed.json` from the existing
  newsletter HTTP server under `/xrpc/app.bsky.feed.getAuthorFeed` and
  point the reader at it (needs a `LORE_BLUESKY_API` override, or the
  scenario patches `FeedReader.fetch` through an env-selected sitecustomize;
  prefer a small `LORE_BLUESKY_API` env read in `FeedReader._bluesky`
  defaulting to `https://public.api.bsky.app`, mirroring
  `LORE_<APP>_SERVER`)
- change `lore/sources.py` (the `LORE_BLUESKY_API` default, three lines)
  and `tests/test_feed.py` (one test that the env is honoured)
- change `app/desktop/support/edge.cjs`

### Test design (edge checks)

1. Bluesky: type the seed handle read from `support/seed/manifest.json`
   `accounts.bluesky.handle` in the sheet (the check reads the manifest;
   the handle is not spelled in `edge.cjs`) → row label is `@<handle>`
   (empty `displayName` in the recording), text `5 posts kept`; Manage
   shows "Connect another" (feeds are additive).
2. Notion: click "Sign in to Notion" (the replay server asks no sign-in,
   like the Granola stub) → row `Notion`, `N pages kept` where N is
   computed in the check from the recording (23 fetches minus errors,
   or 20 after `CAP-017`; compute by counting `fetch-*.json` that are not
   `.error.json` and, if `CAP-017` is merged, that are pages) so the
   check follows the fix without a hand edit.
3. Odd titles: open the memories list filtered to Notion → the nt-04
   title renders verbatim with the emoji and the angle brackets escaped,
   not as an element (`textContent` equals the title; `innerHTML` contains
   `&lt;Roadmap&gt;`).
4. A hosted failure after sign-in: stop the replay server, Read again →
   row says the app "didn't answer. Sign in again." (`renderer.js:1000-1006`)
   with the Sign in again button.
5. Marks: `img.logo` for bluesky and notion resolve to
   `assets/bluesky.svg` / `assets/notion.svg` (APP-122 provenance).

## Acceptance criteria

- [ ] `support/edge.sh connectors` connects Bluesky and Notion from the
      recordings and passes checks 1-5 locally and in CI.
- [ ] No handle or workspace name appears in `edge.cjs` or `edge.sh`; the
      Bluesky handle is read from the manifest at run time.
- [ ] `LORE_BLUESKY_API` is documented next to `LORE_<APP>_SERVER` in
      `docs/connectors.md` and unit-tested.
- [ ] `cd app/desktop && npm test && npm run check` pass; `uv run python
      -m unittest discover -s tests`, ruff check, ruff format --check and
      mypy (paths as in `XC-048`) pass.

## Notes

Covers: W-07 (desktop Bluesky row), W-10 (desktop Notion row; template
pages count), W-20 (mcp failure row wording), C-26, C-28, C-34; R-02,
R-08.

Flakiness/safety: replay server and HTTP server on `127.0.0.1`; null
keyring backend as today. The recording's DID is redacted; the reader
never uses it.

Sequencing: blocked by `XC-050` (`replay.py` and `serve_hosted`).
