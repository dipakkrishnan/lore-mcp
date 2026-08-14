---
id: STO-002
title: Retain owner-supplied source files privately
priority: P3
effort: L
component: store-import
status: in-review
related: [STO-001, CAP-001]
blockers: []
dependencies: ["Concrete owner demand identifying the first supported file types and storage budget"]
github_issue: null
created: 2026-08-05
updated: 2026-08-05
---

## Problem

Lore can turn an owner-supplied file into approved private memories, but it does
not retain a copy of the source file itself. The provenance path can move or
disappear, leaving the owner unable to revisit the original PDF, image, audio,
or other digital asset alongside the memories it informed. The private library
therefore cannot yet serve as an owner-controlled archive of the actual source
material.

## Proposed approach

When concrete owner demand identifies the first useful file types and a
reasonable storage budget, add an explicit, owner-initiated asset intake path.
It should copy supported files into owner-only storage under `LORE_HOME`, record
minimal metadata and a content digest in SQLite, and link any derived memories
back to that local asset. Asset retention is distinct from extraction: storing a
file must neither treat its contents as instructions nor make it available to
the MCP or publication surfaces.

Start with a deliberately small allowlist and clear size limits rather than
claiming support for every digital format. The initial demand should decide
whether documents, images, audio, or another file class comes first; extraction
or transcription for any class remains separate work from retaining its bytes.

## Acceptance criteria

- [ ] An explicit owner command copies a supported source file into private,
      owner-only storage under `LORE_HOME`, while preserving its original file
      outside Lore unchanged.
- [ ] Each retained asset records its content digest, original filename, media
      type, byte size, and import time; adding identical bytes is idempotent.
- [ ] Memories derived from an asset can point to its private asset record
      without exposing the asset path or metadata through MCP discovery, fetch,
      or a publication.
- [ ] Unsupported types, unreadable files, and files over the configured size
      limit fail with an actionable message and never leave a partial asset.
- [ ] The owner can list and deliberately remove retained assets, including the
      relationship to any derived private memories, without deleting the
      original external file.
- [ ] Documentation states the initial supported types, storage location,
      retention behavior, and the fact that assets remain private unless their
      owner separately publishes a bounded derivative.

## Notes

This is intentionally P3. `CAP-001` already covers the attended path where an
agent reads a PDF or image and saves approved private memories; it does not
archive the actual file. `STO-001` reserved uploaded content as a private-tier
concept but deliberately deferred its ingest path.

Do not implement this merely because the item exists. Revisit it when an owner
specifically needs file retention, then use that demand to choose the first file
class and storage budget before promoting it to `ready`.
