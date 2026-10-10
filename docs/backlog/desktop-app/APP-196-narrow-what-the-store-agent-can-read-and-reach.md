---
id: APP-196
title: Narrow what the store agent can read and reach
priority: P2
effort: S
component: desktop-app
status: ready
related: [APP-005]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-07
updated: 2026-10-07
---

## Problem

From the Oct 7 pre-release security review: `bashSandboxPolicy` in
`app/desktop/src/agent.mjs` gives every task read access to
`~/.claude/projects` and `~/.codex/memories`, and the deploy task adds
`~/.npmrc` and unrestricted outbound network (`allowedDomains: ["*"]`).
Text planted in imported writing could steer the agent, mid-deploy, to
send private history or an npm token anywhere. Setup's write access to
`Library/LaunchAgents` lets the model, not app code, install what runs at
login.

## Proposed approach

Drop the history directories from deploy's reads, and `.npmrc` unless a
deploy proves it needs it. Replace `"*"` with the domains a deploy uses
(Cloudflare API and dashboard, the npm registry, `*.workers.dev`, Stripe).
Install the synthesis LaunchAgent from attended app code and remove
`Library/LaunchAgents` from setup's writes.

## Acceptance criteria

- [ ] A deploy-task command can't read `~/.claude/projects`, `~/.codex/memories` or `~/.npmrc`.
- [ ] A deploy-task command can't reach a domain outside the allowlist, and a real store deploy still succeeds.
- [ ] Setup installs the LaunchAgent without the agent writing to `Library/LaunchAgents`.
