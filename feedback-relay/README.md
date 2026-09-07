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

```sh
npm ci
npx wrangler secret put LORE_FEEDBACK_GITHUB_TOKEN   # paste at the prompt
npx wrangler deploy
```

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

Two [Rate Limiting bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
declared in `wrangler.jsonc`, checked in `src/limit.ts`: `FEEDBACK_RATE_LIMIT`
(5 requests/60s, keyed per client IP) and `GLOBAL_RATE_LIMIT` (60
requests/60s, keyed on a constant), so an IP-rotating caller can't still flood
the issue tracker or burn the token's GitHub quota. `period` only accepts 10
or 60 seconds. Neither binding needs an account-side resource to be created
first — the `namespace_id` values in `wrangler.jsonc` are locally chosen
labels, not account lookups.

## Local development

```sh
npm ci
cp .dev.vars.example .dev.vars   # any placeholder value works locally
npm run dev
```

`npm test` runs the full suite against a stubbed GitHub (`test/github.ts`,
modelled on `lore/node/test/facilitator.ts`) — no real network, no real
token. `npm run check` type-checks; `npm run lint` runs ESLint.
