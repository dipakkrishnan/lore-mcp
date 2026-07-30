# Backlog

A git-versioned backlog for lore-mcp. Every unit of work is a single markdown
file with YAML frontmatter, living in the component folder it belongs to.
`INDEX.md` is a **derived** table of every item — it is regenerated from the
item files, never hand-edited, and never the source of truth.

## Components

Each component folder holds the items for one part of the codebase, and owns
one ID prefix:

| Folder | Prefix | Covers |
|---|---|---|
| `store-import/` | `STO` | `lore/store.py`, `lore/sources.py`, `lore/paths.py` |
| `blueprint/` | `BP` | `lore/blueprint.py`, persona interview |
| `automation-synthesis/` | `AUT` | `lore/automation.py`, synthesis prompts/scheduling |
| `mcp-server/` | `MCP` | `lore/mcp.py` |
| `monetization/` | `MON` | pricing, `lore/payments/`, x402 payment policy |
| `deployment/` | `DEP` | `lore-deploy`, cloud providers, publication export |
| `cli-ux/` | `CLI` | `lore/cli.py`, `lore/ui.py` |
| `onboarding/` | `ONB` | `skills/lore-onboard/`, `install.sh` |
| `docs/` | `DOC` | top-level README, `docs/*.md` |
| `cross-cutting/` | `XC` | spans multiple components, or project-wide |

Each folder's own `README.md` is the authority on what belongs there. If a
new component emerges that doesn't fit any of these, add a folder with its
own README and prefix rather than overloading `cross-cutting/`.

## Item file format

Filename: `<component-folder>/<ID>-<kebab-slug>.md`, e.g.
`automation-synthesis/AUT-001-retry-failed-synthesis-run.md`.

Copy `_template/item.md` to start one. Frontmatter fields:

| Field | Meaning |
|---|---|
| `id` | `<PREFIX>-NNN`, zero-padded to 3 digits, unique within its prefix |
| `title` | short imperative phrase |
| `priority` | `P0` now · `P1` next · `P2` soon · `P3` someday |
| `effort` | t-shirt size: `XS` (<1h) `S` (1-4h) `M` (half-day-2d) `L` (~1wk) `XL` (>1wk, consider splitting) |
| `component` | the owning folder's slug (the "directive/project") |
| `status` | see lifecycle below |
| `related` | ids worth reading together, no ordering implied |
| `blockers` | ids that must reach `completed` (or `obsolete`) before this can start |
| `dependencies` | non-backlog prerequisites (external services, decisions, other repos) |
| `github_issue` | URL of the GitHub issue this item was cataloged from, or `null` |
| `created` / `updated` | ISO `YYYY-MM-DD` |

Body sections: `## Problem`, `## Proposed approach`, `## Acceptance criteria`,
`## Notes`.

## Status lifecycle

```
ideation -> in-review -> ready -> in-progress -> completed
                     \-> obsolete
```

- **ideation** — raw idea, may be underspecified. Anyone/any agent can add these.
- **in-review** — has Problem/approach/acceptance filled in, awaiting a
  prioritization pass to confirm it's worth doing.
- **ready** — approved, unblocked (or blockers understood), waiting to be picked up.
- **in-progress** — someone/some agent is actively implementing it.
- **completed** — acceptance criteria met and merged.
- **obsolete** — closed without being built, because the thing it depended on
  or argued about went away. Terminal, like `completed`. The item file stays
  (the backlog is the record of decisions, not just of work), and `## Notes`
  must say what killed it. Reachable from any status.

Items don't skip backward silently — if `in-progress` work stalls or turns
out wrong, the audit pass (below) is what moves it back and says why in
`## Notes`.

## The four management tasks

Playbooks live in `agents/` as plain instruction files (`AGENTS.md` +
task-specific `.md`), and are also invocable as Claude Code skills
(`skills/backlog-*`). See `agents/AGENTS.md` for the overview.

1. **Ideation** (`agents/ideation.md`) — turn a raw idea into a well-formed item.
2. **Implementation** (`agents/implementation.md`) — take a `ready` item to `completed`.
3. **Audit** (`agents/audit.md`) — verify integrity and regenerate `INDEX.md`.
4. **Prioritization** (`agents/prioritization.md`) — re-rank `ready`/`in-review` items.

Scheduled jobs that chain these together live in `automation/` — see
`automation/README.md` to install one as a Claude Code routine or a crontab
entry.

## GitHub issue cataloging

Open GitHub issues get folded into the backlog the same way any other raw
idea does — via `ideation` — but with two extra steps once the item(s) exist:
a comment is left on the issue linking back to the backlog item(s), and the
issue is labeled `backlog-cataloged` so it's never processed twice. See the
"Cataloging a GitHub issue" section of `agents/ideation.md` for the exact
steps, `automation/github-catalog.md` for the scheduled sweep over all open
issues, and the `backlog-catalog-issue` skill for cataloging one issue on
demand. This flow needs the `gh` CLI authenticated with at least triage
access on the target repo (to add labels and comments) — see
`automation/README.md` for details and current status.

## Manual workflow (no agent)

You can do all of this by hand too:

1. Copy `_template/item.md` into the right component folder.
2. Pick the next free id for that prefix (highest existing + 1 — check both
   the component folder and `INDEX.md`).
3. Fill in frontmatter and body, set `status: ideation` or `in-review`.
4. Run the audit playbook (or just re-sort `INDEX.md` by hand) to add its row.
