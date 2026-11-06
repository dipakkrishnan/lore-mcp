# yourlore.dev

The Lore website, a Cloudflare Worker with the `yourlore.dev` and `www.yourlore.dev`
custom domains bound. `/` is the home page (`src/home.js`), drawn around the live bids;
`/download` sends the latest Mac release. `/marketplace` is rendered by `src/worker.js` from the
[lore-marketplace](https://github.com/dipakkrishnan/lore-marketplace) list,
refreshed within about ten minutes of a change to the list, and
`/marketplace.json` serves the list itself at a short, stable address.
`src/agents.js` is the front door for agents (XC-116): `/llms.txt`,
`/robots.txt`, `/sitemap.xml`, `/marketplace.jsonl` (one line per listed piece
and open bid) and each market's JSON at `/marketplace/<market>.json`, all drawn
from the same exchange the pages render. `public/` holds only
static files (the icon); any other path gets the site's not-found page.

The home page shows only real bids. With none open it falls back to `FEATURED` in
`src/home.js`, a list the owner edits by hand, and with that empty it leaves the block out.

`/bids`, `/bids.json` and `/b/:id` are the bid book ([contracts/bids.md](../contracts/bids.md)),
kept in the `BidBook` SQLite Durable Object (binding `BIDS`).

## Deploy

```sh
cd site && npm ci && npx wrangler deploy
```

The first deploy with bids applies the `v1` migration (`new_sqlite_classes: ["BidBook"]`)
and creates the two rate-limit bindings; neither needs an account-side resource. Adding
answers and taking bids down need the owner's token, set once as a secret:

```sh
npx wrangler secret put BIDS_ADMIN_TOKEN   # e.g. the output of: openssl rand -hex 32
```

Without it every owner route answers 401. Use it as `Authorization: Bearer <token>` on
`POST /b/:id/answers` and `DELETE /b/:id`.

A person's bid saves a card first (MON-054). The `CHECKOUT` service binding names the
card checkout Worker's `BidCards` entrypoint (`checkout/`), which talks to Stripe; this
Worker holds no Stripe key. Checkout reports saved cards and settled charges back through
this Worker's `BidRail` entrypoint, which no route exposes. Deploy `checkout/` with its
platform webhook secret before or alongside this Worker; until it is live, a person's bid
can't be placed and says so.

## Test

```sh
cd site && npm ci && npm test
```

Runs in the local Workers runtime (miniflare); nothing reaches Cloudflare.

## Release asset

The Download button opens `/download` (src/download.js), which starts
`https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.dmg`
and says how to open Lore in three steps (XC-125). The disk image is the first
install; the zip stays on every release for the app's own updates. Upload both
under these stable names:

```sh
cp app/desktop/out/make/Lore-*.dmg Lore-macOS-arm64.dmg
cp app/desktop/out/make/zip/darwin/arm64/Lore-darwin-arm64-*.zip Lore-macOS-arm64.zip
gh release upload <tag> Lore-macOS-arm64.dmg Lore-macOS-arm64.zip --clobber
```

Keep the zip's name: the app updates itself through update.electronjs.org, which
picks the mac asset by `-macOS`/`-darwin` and `-arm64` in its name (APP-126).
Don't deploy this site before a release carries the `.dmg`, or the link 404s.

The files are far over Cloudflare's 25 MiB asset cap, so the binary lives on
GitHub Releases; the Worker serves only this page.
