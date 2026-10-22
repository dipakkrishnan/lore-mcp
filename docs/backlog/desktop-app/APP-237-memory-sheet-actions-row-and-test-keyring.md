---
id: APP-237
title: The memory sheet's actions get a row of their own, and the desktop tests never ask for the owner's keychain
priority: P2
effort: S
component: desktop-app
status: in-review
related: [APP-234, APP-235]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-22
updated: 2026-10-22
---

## Problem

When #527 added Delete, the memory sheet ended up with four labelled actions plus the close button in the title's row. The title then got about 40% of the sheet, so "Agent evaluation as counterfactual policy testing, not score ranking" wrapped onto four lines.

When `npm test` ran in `app/desktop`, the "listing switches the store on" test ran `lore store list`. That read a connector's sign-in through `keyring` from the owner's real login keychain. macOS showed "python3.11 wants to use your confidential information stored in "Lore"", and the test hung until it timed out.

## Approach

- The actions go in a `.sheet-actions` row below the title and source line. The title and close button keep the top row, so the title gets the full width. Draft for sale comes first when it's offered, and Delete sits apart at the far right.
- `app.test.cjs` sets `PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring`, as `test_cli_smoke.py` and `edge.sh` already do.

## Acceptance

- A long title wraps across the sheet's full width, and the actions sit in one row under it.
- `npm test` never touches the login keychain.
