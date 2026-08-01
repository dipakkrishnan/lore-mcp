# Backlog Index

Derived from the frontmatter of every item file under `docs/backlog/`. Do not
hand-edit this table — regenerate it with the `audit` playbook
(`agents/audit.md`) or the `backlog-audit` skill after adding, editing, or
completing any item. See `README.md` for the metadata schema.

Sorted by `status` (ideation → in-review → ready → in-progress → completed →
obsolete), then `priority` (P0 → P3).

| ID | Title | Priority | Effort | Component | Status | Related | Blockers | Dependencies | Issue |
|---|---|---|---|---|---|---|---|---|---|
| [MON-005](./monetization/MON-005-mainnet-cutover-for-the-x402-adapter.md) | Cut the x402 edge adapter over to mainnet | P3 | M | monetization | ideation | MON-002, MON-003, MON-004 | MON-002, MON-003, MON-004 | "CDP account and API credentials", "Decision to launch the edge adapter at all" | [#25](https://github.com/dipakkrishnan/lore-mcp/issues/25) |
| [CLI-001](./cli-ux/CLI-001-bulk-prune-the-private-library.md) | Bulk-prune the private library instead of one card at a time | P1 | S | cli-ux | in-review | STO-001, XC-001, XC-002 | STO-001 | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [MON-002](./monetization/MON-002-complete-the-base-sepolia-canary-payment.md) | Complete the Base Sepolia canary payment end to end | P1 | S | monetization | in-review | MON-003 | — | "Funded Base Sepolia buyer wallet (faucet test USDC)", "Cloudflare account for deployment" | [#25](https://github.com/dipakkrishnan/lore-mcp/issues/25) |
| [MON-004](./monetization/MON-004-propagate-revocation-to-the-edge-immediately.md) | Propagate publication revocation to the edge immediately | P1 | S | monetization | in-review | MON-003, XC-002 | MON-003 | — | [#25](https://github.com/dipakkrishnan/lore-mcp/issues/25) |
| [XC-002](./cross-cutting/XC-002-intent-driven-publishing-flow.md) | Intent-driven publishing flow (lore-publish + publication review/list/revoke) | P1 | L | cross-cutting | in-review | STO-001, CLI-001, XC-001, MCP-001 | STO-001 | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [XC-004](./cross-cutting/XC-004-run-tests-and-checks-in-ci-on-every-pull-request.md) | Run tests and checks in CI on every pull request | P1 | S | cross-cutting | in-review | XC-003 | — | — | — |
| [EVAL-001](./evals/EVAL-001-evaluate-the-real-pipeline-not-a-roleplay.md) | Evaluate the real Lore pipeline instead of a roleplay prompt | P2 | L | evals | in-review | — | — | — | — |
| [EVAL-002](./evals/EVAL-002-buyer-side-answer-quality-end-to-end.md) | Evaluate answer quality from the buyer's side of the MCP surface | P2 | M | evals | in-review | EVAL-001, MCP-001 | XC-002, MON-003 | — | — |
| [MCP-001](./mcp-server/MCP-001-browsable-publication-tree-for-discovery.md) | Give discover an owner-approved manifest of the node's offerings | P2 | L | mcp-server | in-review | STO-001, XC-002 | XC-002 | — | — |
| [MCP-002](./mcp-server/MCP-002-one-source-of-truth-for-the-mcp-tool-surface.md) | Keep one source of truth for the MCP tool surface | P2 | M | mcp-server | in-review | MON-003, MCP-001 | — | — | — |
| [MON-003](./monetization/MON-003-serve-published-content-from-the-cloudflare-edge.md) | Serve published content from the Cloudflare edge instead of canary strings | P2 | L | monetization | in-review | MON-002, MON-004, XC-002, MCP-002 | STO-001, XC-002 | "Cloudflare account (Workers + D1)", "Decision: is the edge adapter pursued past the MPP origin gate" | [#25](https://github.com/dipakkrishnan/lore-mcp/issues/25) |
| [MON-006](./monetization/MON-006-split-deploy-into-its-own-skill.md) | Move deploy mechanics from the skill into the CLI when edge serving lands | P2 | M | monetization | in-review | MON-002, MON-005, XC-005 | — | — | — |
| [XC-003](./cross-cutting/XC-003-split-test-suite-per-module-and-gate-coverage.md) | Split the test suite into per-module files and gate coverage at 90% | P2 | L | cross-cutting | in-review | STO-001, XC-002 | — | — | — |
| [XC-005](./cross-cutting/XC-005-dry-run-owner-skills-as-conversations.md) | Dry-run every owner skill as a conversation, not just a document | P2 | M | cross-cutting | in-review | XC-004, MON-006 | — | — | — |
| [ONB-001](./onboarding/ONB-001-capture-and-inject-context-via-agent-session-hooks.md) | Capture and inject context via agent session hooks | P3 | L | onboarding | in-review | STO-001, XC-001, XC-002 | XC-002 | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [XC-001](./cross-cutting/XC-001-separate-capture-retention-and-disclosure-decisions.md) | Separate the capture, retention, and disclosure decisions | P3 | S | cross-cutting | in-review | STO-001, CLI-001, ONB-001, XC-002 | — | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [XC-006](./cross-cutting/XC-006-ship-the-owner-skills-as-agent-plugins.md) | Ship the owner skill pack as agent plugins with a marketplace entry | P3 | M | cross-cutting | in-review | XC-005, ONB-001 | — | — | — |
| [AUT-001](./automation-synthesis/AUT-001-detect-actual-local-scheduler-before-installing-claude-routine.md) | Detect the actual local scheduler before installing Claude's routine | P1 | M | automation-synthesis | ready | — | — | — | — |
| [STO-001](./store-import/STO-001-private-by-default-and-publications-table.md) | Private-by-default memories and a separate publications table | P0 | M | store-import | in-progress | CLI-001, ONB-001, XC-001, XC-002 | — | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [DOC-001](./docs/DOC-001-document-backlog-system-in-readme.md) | Document the docs/backlog system in the top-level README | P1 | XS | docs | completed | — | — | — | — |
| [MON-001](./monetization/MON-001-cloudflare-gateway-deployment-guide.md) | Write a deployment guide for the Cloudflare Tunnel / Monetization Gateway path | P2 | L | monetization | obsolete | — | — | — | — |
