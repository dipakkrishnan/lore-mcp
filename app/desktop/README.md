# Lore desktop

The read-only owner console for the APP-001 snapshot.

```sh
npm --prefix app/desktop ci
npm --prefix app/desktop start
```

The app reads the current `LORE_HOME`, or `~/.lore` when it is unset.

```sh
npm --prefix app/desktop run check
npm --prefix app/desktop test
```
