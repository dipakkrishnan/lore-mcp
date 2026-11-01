# yourlore.dev

Static download page for the Lore desktop app, served as Cloudflare Worker
assets with the `yourlore.dev` and `www.yourlore.dev` custom domains bound.
`/marketplace` is rendered by `src/worker.js` from the
[lore-marketplace](https://github.com/dipakkrishnan/lore-marketplace) list,
refreshed within about ten minutes of a change to the list, and
`/marketplace.json` serves the list itself at a short, stable address; every other path is the static site.

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

## Test

```sh
cd site && npm ci && npm test
```

Runs in the local Workers runtime (miniflare); nothing reaches Cloudflare.

## Release asset

The Download button requests the stable URL
`https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.zip`.
electron-forge's maker-zip emits a versioned name, so rename at upload:

```sh
cp app/desktop/out/make/zip/darwin/arm64/Lore-darwin-arm64-*.zip Lore-macOS-arm64.zip
gh release upload <tag> Lore-macOS-arm64.zip --clobber
```

Keep that name: the app updates itself through update.electronjs.org, which
picks the mac asset by `-macOS`/`-darwin` and `-arm64` in its name (APP-126).

The zip is far over Cloudflare's 25 MiB asset cap, so the binary lives on
GitHub Releases; the Worker serves only this page.
