# Seeding findings (2026-09-30)

Observed while connecting Lore to fictional seed accounts. Each is a candidate test or fix.
Corpus canaries, ids and counts live in `manifest.json`; recordings in `tests/fixtures/live/`.

| id | connector | observation | tier |
|----|-----------|-------------|------|
| F-obs-01 | obsidian | The vault never registered in the Obsidian app, so `sources choices obsidian` returns `[]`; connecting by path works. | live |
| F-obs-02 | obsidian | obs-04 and obs-09 are dated by file mtime, not front matter. | component |
| F-obs-03 | obsidian | The source name is a digest of the absolute vault path, so it differs per machine. | contract |
| F-bl-01 | blog | Preview label is the site title ("Tidewell Notes"); connect label is the host (`tidewell-notes.pages.dev`). | contract |
| F-bl-02 | blog | Cloudflare Pages 308-redirects `/x.html` to `/x`; feeds and importers must follow it. | live |
| F-bs-01 | bluesky | Replies and reposts are skipped, and a post under 40 chars is dropped (bs-06..08). | unit |
| F-bs-02 | bluesky | The seeder writes the account DID into the manifest; hygiene rejects it, so it is redacted. | tooling |
| F-nt-01 | notion | A fresh workspace's template pages ("Welcome to Notion", "To Do List" and children) are imported alongside the seed pages (23 total). | live |
| F-nt-02 | notion | The empty page (nt-06) is imported as a title-only memory; the length rule does not drop it. | unit |
| F-nt-03 | notion | The recorder listed 25 pages but fetched 23 (2 errors). | live |
| F-ss-01 | substack | The importer published all 5 posts at once, with original dates and no drafts step. | live |
| F-ss-02 | substack | The publication title is "tidewell lore", not the planned "Tidewell Notes". | contract |
| F-md-01 | medium | Import adds an "Originally published at" footer to each story. | live |
| F-md-02 | medium | The feed exposes the account holder's real name in its channel title; scrub before committing. | tooling |
| F-md-03 | medium | The recorder names its file after the handle; renamed to `01-feed.xml`. | tooling |
| F-cl-01 | claude export | cl-03 is dropped because Lore reads `text` only. Real export: 82 of 94 conversations kept. | unit |
| F-cx-01 | export | Claude's download is five separate zips; `conversations.json` arrives loose after browser unzip. Lore needs one zip. | contract |
| F-xc-01 | all | Test-suite gap: no test asserts that a hit's source is one of the seed sources. | component |

Not done yet: ChatGPT export (waiting on OpenAI), Granola (needs computer-use permissions).
