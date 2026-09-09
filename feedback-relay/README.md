# Lore feedback relay

A small, maintainer-operated Cloudflare Worker with one job: take a feedback
report from `lore report-feedback` (CLI) or the Desktop app's Report Feedback
dialog and file it as a GitHub issue on `dipakkrishnan/lore-mcp`. Owners never
hold a GitHub credential of their own, so this Worker holds one on their
behalf — see `lore/feedback.py` for the client side, `contracts/feedback_report.json`
for the shared field limits, and backlog item `XC-028`.

This is **not** an owner's node. Unlike `lore/node/` (staged into `~/.lore`
and deployed per-owner by `lore node deploy`), this directory is never
packaged into the `lore-mcp` wheel and is deployed exactly once, by a
maintainer, from a full repo checkout.

## Contract

`POST /report` with the JSON shape `lore/feedback.py`'s `Report` model
produces (`report_version`, `title`, `email`, `description`, `metadata`).
Success is `201 { ok: true, issue_url, issue_number }`; every failure is
`{ error: "<one sentence>" }` with the appropriate status — see `src/index.ts`
and `test/relay.test.ts` for the full table (400/413/415/429/502).

No CORS headers, deliberately: both callers POST from Python via `urllib`,
never from a browser, so the absence of `Access-Control-Allow-Origin` means no
web page can drive this endpoint from a visitor's browser.

## Deploy

Until this is done, the feature is off: `lore/feedback.py`'s `RELAY_URL` is
`None`, so `lore report-feedback` refuses before it prompts and the Desktop
app hides its Report Feedback button. Pinning a real address in step 5 is the
single switch that turns it on, and step 6 is what proves the switch works.

```sh
npm ci
npx wrangler secret put LORE_FEEDBACK_GITHUB_TOKEN   # 1. paste at the prompt
npx wrangler deploy                                  # 2.
```

3. Create the `feedback` label on the repo (see below).
4. Put the Worker behind a custom route you own (see below).
5. Set `RELAY_URL` in `lore/feedback.py` to that address and ship it.
6. Submit one real report end to end and confirm the issue lands. Do this
   before the address ships in a release, not after: nothing else has ever
   exercised the real GitHub API. `LORE_FEEDBACK_URL=<the deployed URL> uv
   run lore report-feedback` smokes it without pinning anything first.

The token is a **fine-grained GitHub PAT**, scoped to `dipakkrishnan/lore-mcp`
only, with exactly one permission: **Issues → Read and write**. Never a
classic token, never repo-wide write. Record its expiry somewhere you'll see
it — a silent expiry turns every report into a 502 with no alert beyond
Workers Logs (`observability.enabled` is on).

The repo must already have a `feedback` label, or every issue creation fails
with a 422 from GitHub.

Wrangler secrets are scoped to the Worker's **name** (`lore-feedback-relay` in
`wrangler.jsonc`) — renaming it silently drops the token.

Put the deployed Worker behind a custom route you control
(`https://feedback.lore.<domain>/report`) rather than the default
`*.workers.dev` URL: `lore/feedback.py`'s `RELAY_URL` is baked into every
shipped copy of Lore forever, so the address should not carry your Cloudflare
account subdomain.

## Rate limiting

Three layers, checked in `src/limit.ts` in the order they cost the least:

1. `FEEDBACK_RATE_LIMIT` — a
   [Rate Limiting binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
   keyed per client IP, 5 requests/60s. Blunts one caller's burst.
2. `GLOBAL_RATE_LIMIT` — the same kind of binding on a constant key, 60
   requests/60s. **This is a per-location pre-filter, not an aggregate
   bound.** Rate Limiting counters are maintained per Cloudflare location, so
   a constant key still yields one bucket per location and a caller spread
   across locations gets as many buckets as it has locations. It stays
   because it absorbs most abuse without a Durable Object round trip, and
   for no other reason. `period` only accepts 10 or 60 seconds, and neither
   binding needs an account-side resource — the `namespace_id` values in
   `wrangler.jsonc` are locally chosen labels, not account lookups.
3. `FEEDBACK_QUOTA` — one Durable Object (`src/quota.ts`), holding shared
   authoritative counters in SQLite: **60 issues/minute and 300/hour across
   the whole relay**, whatever addresses a caller uses. Both sit under
   GitHub's secondary limits for content-creating requests (~80/minute,
   500/hour); exhausting those would take the relay down for everyone. This
   is the layer that actually bounds what the GitHub token can be made to
   do, and it is asked last so a request that was going to be refused anyway
   never spends quota. It needs no account-side resource either — the
   `new_sqlite_classes` migration in `wrangler.jsonc` is all it takes, the
   same pattern `lore/node/` uses for `LorePaidMCP`.

## Local development

```sh
npm ci
cp .dev.vars.example .dev.vars   # any placeholder value works locally
npm run dev
```

`npm test` runs the full suite against a stubbed GitHub (`test/github.ts`,
modelled on `lore/node/test/facilitator.ts`) — no real network, no real
token. `npm run check` type-checks; `npm run lint` runs ESLint.
