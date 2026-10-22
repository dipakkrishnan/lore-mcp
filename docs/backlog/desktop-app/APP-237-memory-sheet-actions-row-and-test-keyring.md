---
id: APP-237
title: The memory sheet's header is one Draft for sale pill, an Edit icon and a More menu, and the desktop tests never ask for the owner's keychain
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

- The header keeps one primary action, **Draft for sale**, as a pill when it's offered. Edit is an icon, and **⋯ More** opens a menu with Rename and Delete in red. The menu is a native popover styled like the account menu (shared `.menu` rules). The title keeps most of the width, and Delete is never one click from selling.
- Asking to delete puts its question under the source line, the way the sale note sits, so the header holds only Cancel and Delete.
- `app.test.cjs` sets `PYTHON_KEYRING_BACKEND=keyring.backends.null.Keyring`, as `test_cli_smoke.py` and `edge.sh` already do.

## Acceptance

- A long title wraps to two lines beside a compact action cluster, in every state: default, rename, edit and delete-confirm.
- `npm test` never touches the login keychain.
