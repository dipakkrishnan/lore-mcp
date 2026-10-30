---
id: XC-097
title: Tell an owner whose Mac lost the hosted store's key what happened and what to do
priority: P2
effort: M
component: cross-cutting
status: in-review
related: [XC-088, CAP-039, APP-224, XC-089]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-30
updated: 2026-10-30
---

## Problem

`contracts/hosted-inbox.md` decides that a Mac that lost its key claims a new store.
That decision stands. What goes wrong is everything the owner is told around it. A
Mac can lose the key through a Keychain reset or a lore folder restored without its
Keychain.

**Every signed call mints a key.** `Hosted._send` calls `_key()`, which generates and
saves a new key when the Keychain has none, on any `/owner/sql` call. The Watch poll
reaches this with no owner action. Nothing is overwritten, but the store refuses the
new key. Reproduced on 454fd933 with a stand-in giving the Worker's 401: a `sql()`
call with an empty Keychain saves a new key and raises "...: this request isn't
signed by the store's owner". From reading the code, the owner then sees that text on
Connect, and "can't reach your store" on the source row, which is the wrong diagnosis.

**The owner gets stuck.** Connect only claims when no address exists, and a recorded
store always gives one. So Connect keeps failing with no next step.

**A replacement is silent.** `lore node host` prints a plain "Online: <new address>".
Saves waiting at the old address can't be collected without the old key, and nothing
says so. The desktop never shows it either: `storeOnline` in `state.cjs` discards
the CLI's output.

**Old agents keep saving where nobody can read.** Agent routes need only a claimed
store, so an agent connected to the old address still sees success. From reading the
code, it also drops out of the app's list, and its source row can read as connected
once the new store answers, because the probe only asks whether the store responded.
That false "connected" is the worst symptom.

## Proposed approach

- Only `claim` mints a key. Every other signed call, with no key, makes no request
  and says this Mac no longer holds the store's key and what to do next.
- `claim` reports that it replaced a store, and the old address. The CLI and the
  desktop both say what that means.
- Give Connectors a way forward from this state.

## Acceptance criteria

- [ ] With a recorded store and an empty Keychain, `Hosted.sql` makes no request,
      saves no key and raises `HostedError`. The text says this Mac no longer holds
      the store's key, names the next step, and never says "can't reach".
- [ ] A claim on a recorded store that gets 409 reports that it replaced the store
      and the old address. `lore node host` prints that saves waiting there can't be
      collected and that agents connected to it must connect again.
- [ ] The desktop's Put online and the agent's `open_store` result show the same
      fact, pinned by a test on `state.cjs`.
- [ ] With the key lost, the source row neither reads as connected nor says "can't
      reach your store", and Connectors offers the next step.
- [ ] A Mac with `node_url` and a lost hosted key has a stated outcome, and
      `contracts/hosted-inbox.md` says which.
- [ ] Test stand-ins answer 401 on `/owner/sql` and 409 only on `/claim`, as
      `owner.ts` does.

## Notes

Out of scope: recovering old saves (needs the old key), moving a store (XC-089),
reconnecting on purpose from a new Mac (APP-224), and the inbox key's own handling.
CAP-039 is the inbox-key sibling: `mint()` saves new inbox keys before its send, so a
key-less Connect leaves one behind even when the store refuses it.

The `node_url` case needs a decision, because the code and the contract disagree. The
contract says a Mac with a `node_url` never uses the hosted store; `Hosted.of` and
`run()` keep using a claimed one, and `host_store` returns early, so no route recovers.

A claim gets 409 from another key; every other signed call gets the 401 above, per
`verify` in `lore/node/src/hosted/owner.ts`.
