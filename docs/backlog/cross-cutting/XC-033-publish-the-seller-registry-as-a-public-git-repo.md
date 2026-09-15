---
id: XC-033
title: Publish the seller registry as a public git repo
priority: P1
effort: S
component: cross-cutting
status: completed
related: [XC-022, XC-034, APP-119, MCP-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-09-15
updated: 2026-09-15
---

## Problem

A buying agent can only reach a node whose URL it was handed (`XC-022`).
Every node answers "what does this seller have" through `discover`, but
nothing answers "who is selling", so the personal agents that can already
pay x402 endpoints have nowhere to look.

## Proposed approach

A public repository, `dipakkrishnan/lore-marketplace`, holding one
`marketplace.json`: a version, a name, and a `sellers` array. Each entry
carries only what the node's `discover` already serves publicly: display
name, `/mcp` URL, store URL, CAIP-2 network id, topic list, publication
count, prices, and the listing date. A JSON Schema pins the shape. A
stdlib-only validator checks the file and, with `--live`, that every listed
store answers, and a workflow runs it on every pull request. A pull request
template is the manual listing path until `APP-119` opens the PR from the
app. Delisting is removing the entry. No owner identity beyond the chosen
display name; no private memory; no payout addresses in the file.

## Acceptance criteria

- [x] `marketplace.json` validates against `schema.json` and the validator
      fails on a duplicate node, a non-https URL, a malformed network id, or
      a missing field.
- [x] The workflow runs the validator with `--live` on pull requests.
- [x] The first entry is the live node at lore.dipakrkrishnan.workers.dev
      and an agent with a fetch tool can read the raw file and reach that
      node's `discover` from it.
- [x] README says what the file is, how to list and delist, and how an
      agent uses it, without naming any other product's marketplace.

## Notes

Repo, schema, validator, workflow, and first entry were created on
2026-09-15 in the same session that filed this item; an implementation pass
verifies the criteria above and closes it.

Verified 2026-09-15: `scripts/validate.py --live` passes on the first entry
and fails a doubled entry with a plain-http store, a bad network id, and a
missing date (five errors). The validate workflow ran green on the first
push and is configured for pull requests. `discover` on the listed node
returned 21 publications. README names no other marketplace.
