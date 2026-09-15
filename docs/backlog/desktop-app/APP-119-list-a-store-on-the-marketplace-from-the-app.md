---
id: APP-119
title: List a store on the marketplace from the app
priority: P1
effort: M
component: desktop-app
status: in-review
related: [XC-033, XC-022, XC-031, XC-028, APP-057]
blockers: [XC-033]
dependencies: ["The feedback relay deployed with a PAT that can open pull requests on the registry repo (XC-031 holds the pattern)"]
github_issue: null
created: 2026-09-15
updated: 2026-09-15
---

## Problem

The registry (`XC-033`) is a file in a git repo. A seller in the desktop app
has no GitHub account in the loop and should not need one. Listing has to
be one click, and the owner has to be able to see whether they are pending
or live without understanding pull requests.

## Proposed approach

One card in Settings once the store has pushed at least once: "List on the
marketplace", with two sentences on what is shared (what buyers already see
at your store, nothing else) and a Delist that reverses it. The click sends
the entry to the relay Worker, which fetches the node's `discover` to prove
the URL is live and consistent, then opens a pull request on the registry
repo adding or removing the entry. The relay holds the PAT; the app holds a
listing secret returned on first submit, which gates later delists. The app
reads the raw `main` file and the open PRs for the node URL and shows one of
three states in plain words: Not listed, Pending review, Listed. When a
pending PR merges, the state flips on the next Settings load; no push
notification.

## Acceptance criteria

- [ ] After a first push, Settings shows "List on the marketplace" with the
      disclosure; the click opens a pull request whose entry matches the
      node's `discover` (name, network, topics, count, prices).
- [ ] Settings shows Pending review while the PR is open and Listed once it
      is merged, read from the repo, not from local state.
- [ ] Delist opens a PR that removes the entry and needs the listing secret.
- [ ] Nothing in the entry is absent from the node's public `discover`.

## Notes

Dipak's shape, 2026-09-15: "the user can click to 'list on marketplace'
... that creates a PR on the repo and a pending entry, then once merged, it
flips." Copy stays in outcomes (`XC-025`): no "PR", "GitHub", or "merge" in
the card; "Pending review" is the word.
