# Connectors

A connector is an app or service the owner recognizes. A reader is how Lore
obtains its content. Keep that distinction out of the owner's way.

The Python connector catalog owns identity, setup requirements, validation,
and reader selection. Desktop reads that catalog; it must not maintain a
second list mapping app names to reader kinds or CLI flags. The saved `Source`
is the connection. `Registry` owns import, refresh, replacement, and removal.
Do not add a second connection store.

## Adding an integration

1. Implement a connector with a stable ID, plain-language description, setup
   metadata, and a reader. Reuse a reader when its content format already fits.
2. Register the connector once in Python. Add a bundled brand asset if needed;
   never infer branding from an editable connection label.
3. Validate the selected locator at the connector boundary. A URL connector
   must not inherit a filesystem-path check.
4. Cover connect, read, failure, retry, and disconnect using temporary data.
   A new reader must work through the existing Registry without adding
   connector-specific branches to it.

The shared Desktop flow supports discovered folders, URLs, and one-time files.
Obsidian and Substack exercise different setup shapes. Conversation exports
are imports, not live accounts. A new authorization mechanism, such as OAuth
or macOS Automation, still needs a real access adapter and an appropriate
setup control; metadata alone cannot implement authorization.

## Invariants

- Connecting is opt-in. Imports stay private; connecting never publishes.
- An empty accessible source is connected. Failed reads are named failures,
  not "No notes yet." Permission recovery always leaves a way to retry.
- Replacement establishes the new connection before retiring the old one.
  A failed replacement preserves the working selection and its memories.
- Item identity survives a new export filename. Missing feed links must not
  collapse unrelated posts into one memory.
- Scheduled refresh uses the existing synthesis pre-run sync. One-time imports
  are excluded. The UI says when automatic reading is off.
- Disconnect explicitly offers keep or delete. Publication provenance remains
  intact under either choice.

Python contract tests exercise a newly registered connector and reader through
the existing API. The Electron `connectors` scenario exercises the shared
folder, URL, and file flows and their recovery paths. These are regression
gates for extending the catalog, not a promise that every future service has
the same authentication or data model.
