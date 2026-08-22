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
