# Backlog agents

Four playbooks, each doing one job on the backlog defined in
`docs/backlog/README.md`. An agent following one of these should read this
file first for the shared rules, then read the specific task file.

- [`ideation.md`](./ideation.md) — create a new item from a raw idea.
- [`implementation.md`](./implementation.md) — take a `ready` item to `completed`.
- [`audit.md`](./audit.md) — check integrity, regenerate `INDEX.md`.
- [`prioritization.md`](./prioritization.md) — re-rank `ready`/`in-review` items.

## Shared rules

1. **Item files are the source of truth. `INDEX.md` is derived.** Never hand-edit
   `INDEX.md` outside of the audit playbook's regeneration step. If an item file
   and `INDEX.md` disagree, the item file wins and the disagreement is an audit
   finding.
2. **Never invent an id.** Scan the owning component folder for the highest
   existing `<PREFIX>-NNN` and increment. Never reuse or renumber an id once
   assigned, even after an item is deleted or completed.
3. **Respect the lifecycle** (`ideation -> in-review -> ready -> in-progress ->
   completed`, defined in `README.md`). Only `implementation` moves an item
   into or out of `in-progress`/`completed`. Only `prioritization` changes
   `priority`. Anyone can create `ideation` items; `audit` is what promotes a
   filled-in item to `in-review` if it wasn't already.
4. **Don't cross component boundaries silently.** If an item's true scope spans
   multiple components, that's a signal it belongs in `cross-cutting/` (`XC`
   prefix), not a reason to invent a second id for it elsewhere.
5. **Update `updated:` to today's date** whenever you touch an item file.

## How the automations chain these

Scheduled jobs in `automation/` combine two playbooks per run — e.g. `groom`
runs `audit` then `prioritization` so the index is honest before it's
re-ranked. See `automation/README.md`.
