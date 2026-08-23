# Lore desktop

The owner's console: sign in with Claude or ChatGPT, capture what you learn,
see what Lore kept, and watch your store.

```sh
npm --prefix app/desktop ci
npm --prefix app/desktop start
```

The app reads the current `LORE_HOME`, or `~/.lore` when it is unset. Provider
sign-in is stored with Electron `safeStorage`, backed by Keychain on macOS.
Dictation is ordinary macOS dictation into the capture box; files can be
attached with the paperclip or dropped onto the window.

```sh
npm --prefix app/desktop run check
npm --prefix app/desktop test
npm --prefix app/desktop run test:capture   # attended capture against a disposable Lore home
```

To look at a view without clicking through, render it to a PNG:

```sh
LORE_HOME=$(mktemp -d) app/desktop/node_modules/.bin/electron app/desktop/support/screenshot.cjs out.png today
```

## Packaging

```sh
npm --prefix app/desktop run make   # unsigned Lore.app, zipped under app/desktop/out/make/
```

The `packaging/wheelhouse.sh` hook bundles a pinned `uv` and a wheelhouse —
the lore-mcp wheel, a windup wheel built from its git pin, and every
dependency at the versions in `uv.lock` — into the bundle's Resources. On
first launch the app streams `uv tool install` from that wheelhouse into an
app-owned prefix under its user-data directory (uv fetches its pinned managed
Python; nothing else needs the network), leaving any existing `~/.local` CLI
install untouched. The wheelhouse targets exactly one interpreter and
architecture: the pinned CPython on Apple Silicon. The zip is used instead of
a dmg because `appdmg`'s native modules no longer build on current Node.
This build is minutes long and macOS-only, so it is not part of CI.

Signing is wired but inert. To flip it on when credentials arrive:

```sh
export LORE_SIGN_IDENTITY="Developer ID Application: …"
export APPLE_API_KEY=… APPLE_API_KEY_ID=… APPLE_API_ISSUER=…
```

Confirm the bundle id (`com.lore.desktop` in `forge.config.js`) before the
first signed build; it is baked into notarization and cannot change casually.
