# yourlore.dev

Static download page for the Lore desktop app, served as Cloudflare Worker
assets with the `yourlore.dev` and `www.yourlore.dev` custom domains bound.

## Deploy

```sh
cd site && npx wrangler deploy
```

## Release asset

The Download button requests the stable URL
`https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.zip`.
electron-forge's maker-zip emits a versioned name, so rename at upload:

```sh
cp app/desktop/out/make/zip/darwin/arm64/Lore-darwin-arm64-*.zip Lore-macOS-arm64.zip
gh release upload <tag> Lore-macOS-arm64.zip --clobber
```

The zip is far over Cloudflare's 25 MiB asset cap, so the binary lives on
GitHub Releases; the Worker serves only this page.
