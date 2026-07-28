# Backlog Index

Derived from the frontmatter of every item file under `docs/backlog/`. Do not
hand-edit this table — regenerate it with the `audit` playbook
(`agents/audit.md`) or the `backlog-audit` skill after adding, editing, or
completing any item. See `README.md` for the metadata schema.

Sorted by `status` (ideation → in-review → ready → in-progress → completed),
then `priority` (P0 → P3).

| ID | Title | Priority | Effort | Component | Status | Related | Blockers | Dependencies | Issue |
|---|---|---|---|---|---|---|---|---|---|
| [ONB-001](./onboarding/ONB-001-capture-and-inject-context-via-agent-session-hooks.md) | Capture and inject context via agent session hooks | P3 | L | onboarding | ideation | STO-001, XC-001, XC-002 | XC-002 | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [AUT-001](./automation-synthesis/AUT-001-detect-actual-local-scheduler-before-installing-claude-routine.md) | Detect the actual local scheduler before installing Claude's routine | P1 | M | automation-synthesis | in-review | — | — | — | — |
| [STO-001](./store-import/STO-001-private-by-default-and-publications-table.md) | Private-by-default memories and a separate publications table | P1 | M | store-import | in-review | CLI-001, ONB-001, XC-001, XC-002 | — | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [XC-002](./cross-cutting/XC-002-intent-driven-publishing-flow.md) | Intent-driven publishing flow (lore-publish + publication apply/list/revoke) | P1 | L | cross-cutting | in-review | STO-001, CLI-001, XC-001, MON-001 | STO-001 | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [MON-001](./monetization/MON-001-cloudflare-gateway-deployment-guide.md) | Write a deployment guide for the Cloudflare Tunnel / Monetization Gateway path | P2 | L | monetization | in-review | — | — | Cloudflare account with Tunnel + Monetization Gateway access | — |
| [XC-001](./cross-cutting/XC-001-separate-capture-retention-and-disclosure-decisions.md) | Separate the capture, retention, and disclosure decisions | P2 | S | cross-cutting | in-review | STO-001, CLI-001, ONB-001 | — | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [CLI-001](./cli-ux/CLI-001-bulk-classify-the-review-queue.md) | Bulk-classify the review queue instead of one card at a time | P1 | S | cli-ux | in-progress | STO-001, XC-001, XC-002 | — | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [DOC-001](./docs/DOC-001-document-backlog-system-in-readme.md) | Document the docs/backlog system in the top-level README | P1 | XS | docs | completed | — | — | — | — |
