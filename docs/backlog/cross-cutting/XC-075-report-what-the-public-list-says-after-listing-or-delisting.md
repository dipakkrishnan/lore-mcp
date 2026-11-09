---
id: XC-075
title: Report what the public list says after listing or delisting
priority: P2
effort: S
component: cross-cutting
status: in-review
related: [XC-036, APP-119, MON-036]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

`lore/marketplace.py` answers three commands. `status` reads the public
`marketplace.json` and the store's `listed_name` switch. `list` and `delist`
read only the switch: `list` always returns `pending` with the request link,
and `delist` always returns `none`. On a store that is already on the public
list, both answers are wrong:

- **Stay listed sends the owner to file a duplicate request.** After Delist,
  Settings shows Pending, "Your store leaves the public list within a day",
  and a Stay listed button. That button calls `list`, which returns the
  request link. `changeListing` in `app/desktop/src/renderer.js` opens any
  link it gets back, so the owner's browser opens the listing request form.
  The row then says "Send the request on the page that opened", though the
  store never left the list and stays on it as soon as the name is pushed
  back. `lore marketplace list` on a listed store prints "Almost listed. Send
  the request: …" the same way.
- **Delist says "Not listed" while the store is still listed.** Delist on a
  Listed store returns `{state: none}`, so the row changes to "List on the
  marketplace" and `lore marketplace delist` prints "Not listed." The entry
  stays in the public file until the next daily refresh. `loadListing` reads
  `status` once per store address, so the row keeps saying this for the rest
  of the app session. Only after a relaunch does it say Pending, "leaves
  within a day", which contradicts what the owner was told.
- **"List on the marketplace" right after Delist does the same as Stay
  listed.** Within that session, the row offers "List on the marketplace" for
  a store that is still in the file. Clicking it opens the request form, as
  in the first case.

## Proposed approach

After the push in `list` and `delist`, return what `status` would report:
read the public file and combine it with the new switch. Inferring the state
from the previous switch alone cannot tell "in the file" apart from "request
pending". If the file cannot be read after a push that worked, return
today's answer and do not fail the command. That includes the wrong-shape
`OSError` from `XC-076`. The push is not rolled back on a read failure, so
raising there would report a failure for a switch that already landed.
`test_a_switch_that_landed_does_not_need_the_public_list` pins that
fallback.

## Acceptance criteria

- [ ] `list` on a store whose node is already in the public file returns
      `{state: listed}` with no `url`, and `lore marketplace list` prints
      "Listed on the marketplace."
- [ ] `delist` on a store whose node is in the public file returns
      `{state: pending, action: delist}`, and `lore marketplace delist`
      prints "Leaving the marketplace at the next daily refresh."
- [ ] `list` and `delist` on a store that is not in the file return what they
      return today (`pending`/`list` with the request link, and `none`).
- [ ] If the push works but the file cannot be read, `list` still returns the
      request link and exits 0. `delist` still returns `none`.
- [ ] Stay listed, or List right after Delist, hands the renderer no `url`, so
      `changeListing` opens no browser window. This is checked unattended in
      `app/desktop/test/app.test.cjs` on the `listStore(directory, "list")`
      return value for a store that is in the file, not in an edge scenario.
- [ ] `tests/test_marketplace.py` covers the Python lines above, and the
      `app.test.cjs` listing test covers the desktop line. That includes
      updating the two tests that pin today's answer for a store in the file:
      `test_delisting_switches_the_store_off` (`delist() == none`) and the
      `listStore(directory, "delist")` deep-equal `{state: "none"}`
      assertion.

## Notes

Reproduced on `main` at `99da78f` with a temporary `LORE_HOME`, a
`file://` `LORE_MARKETPLACE_URL` that lists the store's node, and a no-op
push. `delist()` returned `state='none'` and the next `status()` returned
`state='pending' action='delist'`. `list("Ada")` returned `state='pending'
action='list'` with the request link, and the next `status()` returned
`state='listed'`.

`XC-036` replaced the relay-backed listing (`APP-119`) with the node's own
`discover` and a GitHub issue form. Its tests pin today's answers, including
`delist` → `none` for a store that is in the file. `MON-036` covers starting
the registry refresh when a request is filed. Neither covers what these two
commands report afterwards. `APP-119`'s Notes say Settings re-reads the
listing on every visit. That was the relay-era behaviour; the row now reads
it once per store address.

Left out of this item, for prioritization to decide:

- **Stay listed loses the listed name.** Delist clears `listed_name`, and the
  desktop runs `marketplace list --json` without `--name`. Stay listed falls
  back to the blueprint name. An owner with no blueprint name gets "a display
  name is needed; pass --name". An owner whose blueprint name changed is
  relisted under the new name. Keeping the last listed name through a delist
  would fix both.
- **Listings are overcounted.** `usage.record("store.listed")` fires on every
  `list`, including Stay listed and relisting an already-listed store.
