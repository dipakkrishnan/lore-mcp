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
| [DEP-001](./deployment/DEP-001-provider-interface-and-publication-export-bundle.md) | Build the lore-deploy provider interface and publication export bundle | P1 | M | deployment | in-review | DEP-002, DEP-003, ONB-002, XC-002 | STO-001 | — | — |
| [DEP-002](./deployment/DEP-002-aws-provider-s3-bundle-and-lambda-mcp-endpoint.md) | Add the AWS provider — S3 bundle and Lambda MCP endpoint | P1 | L | deployment | in-review | DEP-001, DEP-003, MON-002, XC-004 | DEP-001 | AWS account (owner-controlled) | — |
| [MON-002](./monetization/MON-002-land-the-in-process-x402-payment-gate.md) | Land the in-process x402 payment gate with the Coinbase facilitator | P1 | M | monetization | in-review | MON-001, MON-003, STO-001, XC-002, XC-004 | — | Coinbase CDP account with x402 API keys; x402 and cdp Python packages (payment-only runtime deps; pydantic arrives earlier via PR #19) | — |
| [MON-003](./monetization/MON-003-lore-monetize-skill-for-payout-and-credential-setup.md) | Add a lore-monetize skill for payout address and credential setup | P1 | M | monetization | in-review | MON-002, ONB-002, DEP-001 | MON-002 | Coinbase Wallet (owner-controlled, Base network); Coinbase CDP account with x402 API keys; Second testnet wallet + Base Sepolia USDC faucet funds for the buyer harness | — |
| [ONB-002](./onboarding/ONB-002-hand-off-to-a-branch-when-onboarding-completes.md) | Hand off to a named branch when onboarding completes | P1 | S | onboarding | in-review | ONB-003, DEP-001, MON-003 | — | — | — |
| [XC-002](./cross-cutting/XC-002-intent-driven-publishing-flow.md) | Intent-driven publishing flow (lore-publish + publication apply/list/revoke) | P1 | L | cross-cutting | in-review | STO-001, CLI-001, XC-001, MCP-001 | STO-001 | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [XC-004](./cross-cutting/XC-004-resolve-where-the-payment-gate-runs-for-a-deployed-node.md) | Resolve where the payment gate runs for a deployed node | P1 | S | cross-cutting | in-review | DEP-001, DEP-002, DEP-003, MON-002, MON-003 | — | — | — |
| [DEP-003](./deployment/DEP-003-cloudflare-provider-r2-bundle-and-worker-mcp-endpoint.md) | Add the Cloudflare provider — R2 bundle and Worker MCP endpoint | P2 | L | deployment | in-review | DEP-001, DEP-002, MON-001, XC-004 | DEP-001 | Cloudflare account (owner-controlled) | — |
| [MCP-001](./mcp-server/MCP-001-browsable-publication-tree-for-discovery.md) | Let buyers browse a publication metadata tree instead of only keyword-searching | P2 | L | mcp-server | in-review | STO-001, XC-002 | XC-002 | — | — |
| [ONB-003](./onboarding/ONB-003-lore-test-skill-for-evaluating-a-fresh-library.md) | Add a lore-test skill for evaluating a freshly onboarded library | P2 | S | onboarding | in-review | ONB-002, CLI-001, AUT-001 | — | — | — |
| [XC-003](./cross-cutting/XC-003-split-test-suite-per-module-and-gate-coverage.md) | Split the test suite into per-module files and gate coverage at 90% | P2 | L | cross-cutting | in-review | STO-001, XC-002 | — | — | — |
| [XC-001](./cross-cutting/XC-001-separate-capture-retention-and-disclosure-decisions.md) | Separate the capture, retention, and disclosure decisions | P3 | S | cross-cutting | in-review | STO-001, CLI-001, ONB-001, XC-002 | — | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [AUT-001](./automation-synthesis/AUT-001-detect-actual-local-scheduler-before-installing-claude-routine.md) | Detect the actual local scheduler before installing Claude's routine | P1 | M | automation-synthesis | ready | — | — | — | — |
| [STO-001](./store-import/STO-001-private-by-default-and-publications-table.md) | Private-by-default memories and a separate publications table | P0 | M | store-import | in-progress | CLI-001, ONB-001, XC-001, XC-002 | — | — | [#6](https://github.com/dipakkrishnan/lore-mcp/issues/6) |
| [DOC-001](./docs/DOC-001-document-backlog-system-in-readme.md) | Document the docs/backlog system in the top-level README | P1 | XS | docs | completed | — | — | — | — |
| [MON-001](./monetization/MON-001-cloudflare-gateway-deployment-guide.md) | Write a deployment guide for the Cloudflare Tunnel / Monetization Gateway path | P2 | L | monetization | obsolete | — | — | — | — |
