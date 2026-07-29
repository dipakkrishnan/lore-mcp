---
name: backlog-catalog-issue
description: Catalog one or more open GitHub issues into docs/backlog/ items, then comment on the issue with links to what was filed and label it backlog-cataloged. Use when the user says "catalog this issue", "turn issue #<N> into a backlog item", "catalog open GitHub issues into the backlog", or "sweep GitHub issues into the backlog".
---

# Backlog: catalog a GitHub issue

Read `docs/backlog/agents/AGENTS.md` for the shared rules, then
`docs/backlog/agents/ideation.md`'s "Cataloging a GitHub issue" section and
follow it exactly.

- If `$ARGUMENTS` names a specific issue (number or URL), catalog only that
  one.
- If asked to sweep all open issues, follow
  `docs/backlog/automation/github-catalog.md` instead — it's the same
  playbook applied to every open, uncataloged issue in one run.
- Default target repo is `dipakkrishnan/lore-mcp` unless `$ARGUMENTS`
  specifies another `--repo`. Confirm triage access first
  (`gh api repos/<owner>/<repo> --jq .permissions`) — the comment/label
  steps need it, not just read access.

Do not regenerate `docs/backlog/INDEX.md` yourself beyond what the ideation
playbook's audit step already does, and do not comment or label the issue
until its backlog item(s) are actually saved.
