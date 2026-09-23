# Connectors

A connector is an app the owner recognises: Obsidian, ChatGPT, Claude,
Substack. A reader is how Lore gets the content out of it. The owner only ever
meets the connector; the reader is Lore's business.

Everything about an app lives in one `Connector` subclass in `lore/sources.py`.
Defining the subclass is the whole registration: it appears in
`lore sources catalog`, the desktop reads that catalog to draw its rows and
sheets, and `lore sources connect <app> <locator>` wires it into the source
lifecycle that `Registry` already owns. Neither the CLI nor the desktop keeps a
second table of apps.

```python
class Substack(Connector):
    id = "substack"
    name = "Substack"
    what = "Your published posts"        # the row, in the owner's words
    unit = "newsletter"                  # what they pick: "Choose a newsletter."
    item = "post"                        # what was kept: "12 posts kept."
    reader = FeedReader
    placeholder = "https://you.substack.com"
```

`choices()` is the one optional hook: what the app can offer without asking
(Obsidian reads `obsidian.json` for its vaults). The rule is to ask only for
what cannot be discovered.

## What a reader promises

A `Reader` declares its `kind` (`folder`, `export`, `feed`) and whether it is
read again on schedule (`refresh`; an export is read once). `locate` turns what
the owner typed into the locator Lore saves plus a default label; `probe` says
whether the place is connected, empty, unreachable, or needs permission;
`items` yields what it found, counting what it could not read. `name` is the
source's identity: every spelling of one place is one source, and an export is
named by its product rather than its file, so a newer download replaces the
old one instead of importing it twice. A reader that fails partway records the
failure, and that failure, not the probe, is the state the owner sees.

## What the desktop does with the catalog

Settings → Where memories come from lists every app in the catalog under the
agents. An app with nothing connected is offered with `what` and one button;
a connected one shows its label, its state and what it kept, with Manage. The
sheet's setup control follows `kind`: a folder offers the app's choices and a
folder picker, an export a file picker, a feed an address field. Every app
ships a mark at `assets/<id>.svg`, with its provenance in the file; the initial
is only the fallback for a mark that fails to load.

Changing what a connected app reads goes through `--replace`: the CLI reads the
new place first and retires the old one only if that succeeds, so a stale
choice leaves the working connection and its memories alone. Disconnecting
always asks whether to keep what was imported.

## Adding an integration

1. If the content is a folder, a feed, or a conversation export, write only the
   `Connector` subclass and bundle its mark. Otherwise write a `Reader` for the
   new kind first; a reader that only takes one product's files, as the export
   readers do, is a two-line subclass.
2. A new kind also needs a locator flag in `lore sources add`, and a setup
   control in `openConnect` in the desktop; a new way of authorising access
   (OAuth, macOS Automation) needs a real access adapter, not catalog metadata.
3. Add the app to the `connectors` edge scenario and to the catalog test.

`support/edge.sh connectors` drives all three shapes end to end, including a
refused change and a once-only import, and runs in CI.
