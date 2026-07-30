---
id: ONB-003
title: Add a lore-test skill for evaluating a freshly onboarded library
priority: P2
effort: S
component: onboarding
status: in-review
related: [ONB-002, CLI-001, AUT-001]
blockers: []
dependencies: []
github_issue: null
created: 2026-07-30
updated: 2026-07-30
---

## Problem

Onboarding ends with an agent having read the owner's history and asserted a set
of claims about who they are and what they know. The natural next question is
*"is any of that right?"* — and there is nothing that answers it.

`lore search` exists, but it asks the owner to already know what to search for and
returns raw matches rather than the synthesized claims that were just written on
their behalf. So the most common state right after onboarding — mild scepticism
about what the synthesis captured — has no cheap outlet, and the corrections that
would most improve the library never get made.

## Proposed approach

A `lore-test` skill: a conversational evaluation harness over the private library,
with no deployment, no payment, and no publication involved. Per
`docs/full-service-onboarding.md`, it:

- answers the owner's plain-language questions from the private library via
  `lore search`, citing which memory each claim came from;
- reads back what synthesis captured, framed in the blueprint's persona voice;
- lets the owner mark a surfaced memory wrong or unwanted, routing into the
  existing retention flow (`lore review`, and `CLI-001`'s bulk prune when it
  lands) rather than editing the store directly;
- reports what it could not answer, so the gaps steer the next synthesis run.

One prerequisite this item owns: a non-interactive per-memory status path (e.g.
`lore review --id <n> --set private|discarded`). The existing `lore review` is an
interactive card loop an agent cannot drive, and `CLI-001` as re-scoped does not
provide per-id status either. It is a small `cli-ux` surface, but without it the
correction routing above is unimplementable — coordinate with `CLI-001` rather
than duplicating flags.

This is a confidence loop for the owner, not a benchmark. It reads private rows
directly, which is safe here precisely because nothing in this path can disclose
anything.

## Acceptance criteria

- [ ] The skill answers plain-language questions from the private library and
      cites the memory behind each claim
- [ ] The owner can mark a surfaced memory wrong or unwanted, and the change goes
      through the existing retention flow rather than a direct store write
- [ ] A non-interactive per-memory status command exists for the skill to call —
      the interactive card loop is not scriptable — added here or via `CLI-001`,
      not duplicated in both
- [ ] The skill reports what it could not answer
- [ ] The skill creates no publication, sets no price, and deploys nothing — a
      test asserts no disclosure path is reachable from it
- [ ] It is reachable from the `ONB-002` handoff menu and standalone

## Notes

Transposed from the "Test/Eval" branch of Shane's 2026-07-30 sketch, clarified by
Shane as "a separate branch where the user can test and play around with their
Lore after the initial onboarding experience completed."

Cheapest of the three handoff branches and the one most likely to be chosen first,
since it needs no external account. That argues for building it before `DEP-001`
or `MON-003` despite its lower priority — worth settling in a prioritization pass.

Deliberately kept out of the disclosure path: because this skill reads private rows
freely, nothing in it should be reusable as a publication path. `STO-001`'s
invariant (MCP reads publications, never private rows) is not weakened by a local
harness, but the harness should not become the seam that weakens it later.

Open question in the design doc: whether it may *trigger* a synthesis run to fill a
gap it found, or only report the gap.
