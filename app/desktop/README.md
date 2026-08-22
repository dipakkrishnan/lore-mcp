# Lore desktop

The read-only owner console for the APP-001 snapshot.

```sh
npm --prefix app/desktop ci
npm --prefix app/desktop start
```

The capture box uses ordinary macOS dictation. Provider sign-in is stored with
Electron `safeStorage`, backed by Keychain on macOS.

Run an attended capture against a disposable Lore home with:

```sh
npm --prefix app/desktop run test:capture
```

The app reads the current `LORE_HOME`, or `~/.lore` when it is unset.

```sh
npm --prefix app/desktop run check
npm --prefix app/desktop test
```
