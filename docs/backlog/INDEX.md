# Backlog Index

Derived from the frontmatter of every item file under `docs/backlog/`. Do not
hand-edit this table — regenerate it with the `audit` playbook
(`agents/audit.md`) or the `backlog-audit` skill after adding, editing, or
completing any item. See `README.md` for the metadata schema.

Sorted by `status` (ideation → in-review → ready → in-progress → completed →
obsolete), then `priority` (P0 → P3).

| ID | Title | Priority | Effort | Component | Status | Related | Blockers | Dependencies | Issue |
|---|---|---|---|---|---|---|---|---|---|
| [ONB-001](./onboarding/ONB-001-capture-and-inject-context-via-agent-session-hooks.md) | Capture and inject context via agent session hooks | P3 | L | onboarding | ideation | STO-001, XC-001, XC-002 | XC-002 | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [CLI-001](./cli-ux/CLI-001-bulk-prune-the-private-library.md) | Bulk-prune the private library instead of one card at a time | P1 | S | cli-ux | in-review | STO-001, XC-001, XC-002 | STO-001 | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [XC-002](./cross-cutting/XC-002-intent-driven-publishing-flow.md) | Intent-driven publishing flow (lore-publish + publication apply/list/revoke) | P1 | L | cross-cutting | in-review | STO-001, CLI-001, XC-001, MCP-001 | STO-001 | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [EVAL-001](./evals/EVAL-001-evaluate-the-real-pipeline-not-a-roleplay.md) | Evaluate the real Lore pipeline instead of a roleplay prompt | P2 | L | evals | in-review | — | — | — | — |
| [MCP-001](./mcp-server/MCP-001-browsable-publication-tree-for-discovery.md) | Let buyers browse a publication metadata tree instead of only keyword-searching | P2 | L | mcp-server | in-review | STO-001, XC-002 | XC-002 | — | — |
| [XC-003](./cross-cutting/XC-003-split-test-suite-per-module-and-gate-coverage.md) | Split the test suite into per-module files and gate coverage at 90% | P2 | L | cross-cutting | in-review | STO-001, XC-002 | — | — | — |
| [XC-001](./cross-cutting/XC-001-separate-capture-retention-and-disclosure-decisions.md) | Separate the capture, retention, and disclosure decisions | P3 | S | cross-cutting | in-review | STO-001, CLI-001, ONB-001, XC-002 | — | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [AUT-001](./automation-synthesis/AUT-001-detect-actual-local-scheduler-before-installing-claude-routine.md) | Detect the actual local scheduler before installing Claude's routine | P1 | M | automation-synthesis | ready | — | — | — | — |
| [STO-001](./store-import/STO-001-private-by-default-and-publications-table.md) | Private-by-default memories and a separate publications table | P0 | M | store-import | in-progress | CLI-001, ONB-001, XC-001, XC-002 | — | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [DOC-001](./docs/DOC-001-document-backlog-system-in-readme.md) | Document the docs/backlog system in the top-level README | P1 | XS | docs | completed | — | — | — | — |
| [MON-001](./monetization/MON-001-cloudflare-gateway-deployment-guide.md) | Write a deployment guide for the Cloudflare Tunnel / Monetization Gateway path | P2 | L | monetization | obsolete | — | — | — | — |
