# Backlog automation

Scheduled jobs that chain two or more of the four backlog playbooks
(`docs/backlog/agents/`) together into one recurring run. Each job is a
plain prompt file — the cadence and reasoning for chaining live in the file
itself, not here.

| Job | Cadence (suggested) | Chain |
|---|---|---|
| [`groom.md`](./groom.md) | daily | `audit` → `prioritization` |
| [`ideation-sweep.md`](./ideation-sweep.md) | weekly | `ideation` scan → `audit` |
| [`delivery.md`](./delivery.md) | weekly, opt-in | `prioritization` → `implementation` (top item only) |

No schedule is installed by creating these files — pick one of the two
install paths below for whichever jobs you want running.

## Option A: Claude Code routine

Use the `/schedule` skill (or the Routines UI in Claude Desktop) to create a
**local** routine per job — local matters because the prompt reads and
writes files in this repo:

1. `/schedule` → create a new routine.
2. Set the cadence from the table above (or your own preference).
3. For the prompt, use the full contents of the job's `.md` file (e.g.
   `docs/backlog/automation/groom.md`) — paste it in, don't just reference
   the path, since the routine's prompt is what actually runs.
4. Set the working directory to this repo's root.

## Option B: crontab

Same jobs, run headlessly via the `claude` CLI. This mirrors how
`lore/automation.py` already drives agents headlessly for memory synthesis
(`setup_command` in that file) — same flags, different prompt source.

```sh
# crontab -e
# groom: daily at 03:00
0 3 * * * cd /absolute/path/to/lore-mcp && claude -p --permission-mode auto -- "$(cat docs/backlog/automation/groom.md)" >> /tmp/lore-backlog-groom.log 2>&1

# ideation-sweep: weekly, Monday 03:00
0 3 * * 1 cd /absolute/path/to/lore-mcp && claude -p --permission-mode auto -- "$(cat docs/backlog/automation/ideation-sweep.md)" >> /tmp/lore-backlog-ideation.log 2>&1

# delivery: weekly, opt-in — uncomment once you're comfortable with unattended implementation
# 0 4 * * 1 cd /absolute/path/to/lore-mcp && claude -p --permission-mode auto -- "$(cat docs/backlog/automation/delivery.md)" >> /tmp/lore-backlog-delivery.log 2>&1
```

Replace `/absolute/path/to/lore-mcp` with this repo's actual path. `--permission-mode auto`
lets the job edit backlog files and (for `delivery`) source files without an
interactive approval prompt — review its log output regularly, especially
for `delivery`.

## Adding a new job

A new scheduled job is just a new `.md` file in this folder stating: what it
chains, why in that order, and its suggested cadence — then a line added to
both install-path sections above.
