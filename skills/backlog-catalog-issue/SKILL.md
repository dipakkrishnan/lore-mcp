---
name: backlog-catalog-issue
description: Catalog one or more open GitHub issues into docs/backlog/ items, then comment on the issue with links to what was filed and label it backlog-cataloged. Use when the user says "catalog this issue", "turn issue #<N> into a backlog item", "catalog open GitHub issues into the backlog", or "sweep GitHub issues into the backlog".
---

# Backlog: catalog a GitHub issue

Read `docs/backlog/agents/AGENTS.md` for the shared rules, then
`docs/backlog/agents/ideation.md`'s "Cataloging a GitHub issue" section and
follow it exactly.

- If the request names a specific issue (number or URL), catalog only that
  one.
- If asked to sweep all open issues, follow
  `docs/backlog/automation/github-catalog.md` instead — it's the same
  playbook applied to every open, uncataloged issue in one run.
- Default target repo is `dipakkrishnan/lore-mcp` unless the request
  specifies another `--repo`. Confirm triage access first
  (`gh api repos/<owner>/<repo> --jq .permissions`) — the comment/label
  steps need it, not just read access.

Do not regenerate `docs/backlog/INDEX.md` yourself. Where the ideation
playbook's cataloging section says to run `audit`, invoke the `backlog-audit`
skill (via the Skill tool) directly rather than just noting it should
happen. Call it once you've created backlog item(s) for an issue, before
commenting/labeling that issue — skip the call only for issues that turned
out to be pure dedupes/no-ops with no new item(s) created. Do not comment or
label the issue until its backlog item(s) are actually saved.
