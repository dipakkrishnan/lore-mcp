# How each connector was set up and what it reads (2026-09-30)

Observed while seeding fictional accounts and connecting them to a real Lore install.
Source of truth for counts is `manifest.json`; raw answers are in `tests/fixtures/live/<connector>/`;
surprises are in `findings.md`. "Observed" means seen this session; "assumed" means read from
code or docs and not yet seen live. Nothing here contains a credential or a real identity.

Shared rules (code): `Reader.sentence = 40` (an owned item shorter than 40 characters is dropped);
`FeedReader.limit = 40`, `pages = 5`, user agent `Lore/<version> (+https://yourlore.dev)`, timeout 20 s;
`HostedReader.pages = 10`; a source is named `<connector>-<8-hex digest of its locator>`, except an
export, which is `<connector>-export`.

## Obsidian (folder) — connected, 9 kept of 12 found
- **Connect:** `lore sources connect obsidian <vault path>`. `sources choices obsidian` reads Obsidian's
  own `obsidian.json`; it returned `[]` because the app never registered the vault, so the path was used directly.
- **Input:** a folder of `**/*.md`, optional YAML front matter with `date`.
- **Kept / dropped:** skips `.obsidian`, `.trash` and `templates` folders; drops blank templates and notes under 40 characters.
  Notes with no front matter date take the file mtime (obs-04, obs-09).
- **Identity:** the source name digests the absolute path, so it differs per machine.
- **Recorded:** `obsidian/cli.jsonl` (CLI answers). Re-reading unchanged: 9 unchanged, 0 added.

## Blog (feed) — connected, 5 kept of 6 found
- **Setup:** static site on Cloudflare Pages (`tidewell-notes`); the first `pages project create` and first deploy
  needed `wrangler ... --force` (Pages commands delegate to Workers). Pages 308-redirects `/x.html` to `/x`.
- **Connect:** `lore sources connect blog https://<site>`; feed found at `/feed.xml` (guesses: `/feed`, `/rss/`, `/atom.xml`, `/feed.json`).
- **Served as:** `application/xml`, `cache-control: public, max-age=0, must-revalidate`; the Lore user agent is not blocked.
- **Labels:** preview label is the site title ("Tidewell Notes"); connect label is the host. The short note (bl-06) is dropped as under the 40-character floor.
- **Recorded:** `blog/01-index.html`, `blog/02-feed.xml`.

## Bluesky (feed) — connected, 5 kept of 7 found
- **Setup:** free account. Seeding used an app password (Keychain service `lore-seed-bluesky`) against `https://bsky.social`
  (`createSession`, then `createRecord`); 8 records (6 posts, 1 reply, 1 repost).
- **Connect:** `lore sources connect bluesky @<handle>`; no sign-in, Lore reads public data.
- **Endpoint read:** `https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=<handle>&filter=posts_no_replies&limit=40`.
- **Kept / dropped:** replies never arrive (server-side filter); reposts and posts under 40 characters are dropped.
- **Recorded:** `bluesky/01-app-bsky-feed.json` (the account DID is redacted to `did:plc:REDACTED`).

## Notion (hosted MCP) — connected, 23 pages read
- **Setup:** free workspace. Seeding used an internal-integration token (Keychain service `lore-seed-notion`) with the REST API
  (`Notion-Version: 2022-06-28`) to create a "Tidewell HQ" page and 6 children. The integration only sees pages shared with it.
- **Connect:** `lore sources connect notion` prints an approval link; approve in a browser signed in to the workspace.
  OAuth is dynamic client registration with a loopback callback; tokens go to the macOS Keychain.
- **Reads:** `notion-search` (query `""`, `filters.created_date_range.start_date = 2000-01-01`, `page_size 25`, 2 s pause,
  30 searches a minute) then `notion-fetch` per page. Listed 25, fetched 23; both errors were databases (fetch answered with an error).
- **Gotchas:** a fresh workspace's template pages are read too; an empty page becomes a title-only memory.
- **Recorded:** `notion/` (tools list, list answer, 23 fetches, 2 error answers, tool access).

## Substack (feed) — connected, 4 kept of 5 found
- **Setup:** free account and publication (`tidewell2lore`, titled "tidewell lore"). Content came from Settings > Import posts,
  pointed at an RSS file on the seed site; the importer published all 5 posts at once with their original dates. No Stripe.
- **Connect:** `lore sources connect substack https://<publication>.substack.com` (a handle is refused); feed at `/feed`.
- **Kept / dropped:** the short "Housekeeping" post (ss-05) is dropped as under the 40-character floor. Label is the host.
- **Recorded:** `substack/01-index.html`, `substack/02-feed.xml`.

## Medium (feed) — connected, 4 kept
- **Setup:** free account on the owner's real email (the seed plus-address was not usable). Content came from
  `medium.com/p/import` with a story URL, then Publish. Import adds an "Originally published at" footer.
  Typing right after a fresh page load was sometimes lost; check the field before submitting.
- **Connect:** `lore sources connect medium @<handle>` → locator `https://medium.com/feed/@<handle>`, label `@<handle>`.
- **Limits:** the feed holds only the 10 most recent stories. The channel title carries the owner's real name, so recordings are scrubbed.
- **Recorded:** `medium/01-feed.xml` (feed XML, double-escaped HTML kept byte-exact). Stretch stories md-05..11 not published.

## Claude export — connected, 82 kept of 94
- **Get it:** Claude desktop > Settings > Privacy > Export data; an email links five separate zips
  (`conversations`, `projects`, `memories`, `frames`, `light_metadata`). Download links need a signed-in browser (plain `curl` gets 403).
  Only `conversations.json` matters; it arrived unzipped, so it was zipped into one archive.
- **Connect:** `lore sources connect claude <zip>`; source name `claude-export`, read once (`refresh = false`).
- **Shape (keys only):** top-level array; each conversation has `uuid`, `name`, `summary`, `created_at`, `updated_at`, `account`,
  `chat_messages[]`; each message has `uuid`, `sender`, `text`, `content[]`, `attachments[]`, `files[]`, `created_at`, `updated_at`,
  `parent_message_uuid`. Lore reads `text` only. Provider is detected by absence of `mapping`.
- **Kept / dropped:** a conversation is kept only if one of the owner's messages has 40 or more characters in `text`. The 12 dropped: 11 where every owner message is under 40 characters (one of those has an attachment or file, whose `extracted_content` Lore does not read) and 1 whose owner text is empty. No conversation was dropped for having no messages.
- **Recorded:** `exports/claude/real-shape.json` (paths and value types, no values). Real content is never committed.

## ChatGPT export — not connected yet (assumed)
- **Get it:** chatgpt.com > Settings > Data controls > Export data; an emailed link, valid 24 hours.
- **Shape (assumed):** `conversations.json` whose entries carry `mapping`; provider is chatgpt when `mapping` is present.
- **Recorded:** only the synthetic fixture in `exports/chatgpt/`.

## Granola (hosted MCP) — sign-in works; not connected
- **Connect:** `lore sources connect granola` prints an approval link (`mcp-auth.granola.ai`, scopes `mcp offline_access`).
  Lore waits 5 minutes for the callback; an unanswered wait reads as "didn't let Lore in", like a refusal.
- **Tools (observed):** `list_meetings` (only `time_range`: `this_week` | `last_week` | `last_30_days`), `get_meetings`
  (`meeting_ids`, 1 to 10 uuids), `query_granola_meetings`, `list_meeting_folders`, `get_meeting_transcript`, `get_account_info`.
- **Bug found:** Lore sends `time_range: "custom"` with dates, which Granola now rejects. One-line local fix: `{"time_range": "last_30_days"}`.
- **Account:** a Google account with no Granola account gets "Unauthorized: user has not created a Granola account yet";
  Lore shows only "can't reach Granola".
- **Answers (assumed, from code):** loosely escaped XML; `<meeting id= title= date=>`, sections `private_notes`, `summary`, `notes`;
  dates like `Sep 30, 2026 2:15 PM`. Not yet seen live; the free plan shows 30 days.
- **Recorded:** `granola/tools-schema.json` (tool names and input schemas only).

## Readwise (hosted MCP) — not attempted (needs a paid plan)
- **Assumed from code:** keeps a document only if it has highlights; `results[]` with `id`, `title`, `saved_at`; cursor `nextPageCursor`.
