# Full-service onboarding

Design notes for the handoff model that runs *after* `lore-onboard` finishes. Transposed
from a paper sketch (2026-07-30, Shane) and reconciled against the current `main`.

## What this is

The existing onboarding experience is good enough for the job it has: getting private
memory and content into Lore. `lore-onboard` captures a blueprint, drafts a profile,
installs synthesis automation, and backfills history. It ends with `lore status`,
`lore blueprint show`, and a review prompt.

Then it stops. The owner has a populated private library and no idea what to do with it.

This doc adds the missing last step: **an explicit handoff menu**. When onboarding
completes, Lore names what the owner can do next and hands off to a skill that does it.
Nothing here changes the capture phase — it only makes the boundary at the end of it a
decision point instead of a dead end.

## The shape

```
[owner] → Installation → Onboard ──┬──→ Nothing / Done
                                   ├──→ Test / Eval
                                   ├──→ Deploy
                                   └──→ Monetize
```

Three of the four branches hand off to a dedicated skill, so an onboarded Lore is the
common input to all of them:

```
                        ┌──→ lore-test      (Test / Eval)
[onboarded Lore] ───────┼──→ lore-deploy    (Deploy)
                        └──→ lore-monetize  (Monetize)
```

The branches are ordered by commitment, not by value. "Nothing" is a first-class,
zero-guilt outcome — the README's *useful before monetized* principle means a Lore that
is never deployed and never monetized has already paid for itself through private
recall. The menu must not read as a funnel.

### The four branches

| Branch | What the owner wants | Handoff | Doc |
|---|---|---|---|
| **Nothing / Done** | "I'm set, leave me alone" | none — exit cleanly | — |
| **Test / Eval** | "Let me play with this and see if it actually knows me" | `lore-test` skill | this doc, below |
| **Deploy** | "Make my Lore reachable by other agents" | `lore-deploy` skill | `deployment-mvp.md` |
| **Monetize** | "Get paid when another agent uses it" | `lore-monetize` skill | `monetization-mvp.md` |

Deploy and Monetize are **independent, not sequential**. Deploying without monetizing is
a valid free public node. Monetizing without deploying is valid too — `lore serve` on
loopback with an x402 gate is payable over a tunnel the owner already runs. The menu
must not imply Deploy is a prerequisite for Monetize.

### Test / Eval

The cheapest branch and the one most likely to be chosen first. The owner just finished
watching an agent read their history and assert things about them; the natural next
question is *"is any of that right?"*

`lore-test` is a conversational harness over the private library — no deployment, no
payment, no publication. It:

- runs `lore search` against questions the owner asks in plain language;
- reads back what the synthesis captured, framed in the blueprint's persona voice;
- lets the owner correct or discard what is wrong, feeding straight into the retention
  flow (`lore review`, and `CLI-001`'s bulk prune when it lands);
- surfaces the gap the owner cares about: what Lore *doesn't* know yet.

This is an evaluation loop for the owner's confidence, not a benchmark. It reads private
rows directly — which is safe precisely because nothing here can disclose anything.

## Requirements

### Functional — the handoff (skill)

- **FR1** On completing its backfill and status pass, `lore-onboard` SHALL present the
  four branches as a single structured choice, with "Nothing / Done" as an equal option
  and not a decline.
- **FR2** Each branch SHALL state its concrete next action and its cost in one line
  before the owner picks — including that Deploy and Monetize both need external
  accounts.
- **FR3** On picking Test / Eval, Deploy, or Monetize, the skill SHALL hand off to the
  named skill in the same conversation, passing the blueprint and profile as context
  rather than re-asking anything.
- **FR4** On picking Nothing / Done, the skill SHALL exit after telling the owner how to
  return to the menu later (`lore handoff`, or invoking the skill by name).
- **FR5** The skill SHALL record each branch taken as *history* in a dedicated handoff
  state file (`$LORE_HOME/automation/handoff.json`), so a resumed session does not
  re-run a finished branch. The onboarding checkpoint (`onboarding.json`) is validated
  and consumed by `lore profile` and SHALL NOT carry handoff keys. Taking one branch
  never suppresses the menu or the remaining branches later.
- **FR6** The menu SHALL be reachable independently of onboarding, so an owner who chose
  Nothing can come back to it months later without re-running setup.

### Functional — Test / Eval (`lore-test`)

- **FR7** `lore-test` SHALL answer the owner's plain-language questions from the private
  library via `lore search`, citing which memory each claim came from.
- **FR8** It SHALL let the owner mark a surfaced memory wrong or unwanted, routing to
  the retention flow rather than editing the store directly. This needs a
  non-interactive per-memory status path (e.g. `lore review --id <n> --set discarded`)
  that does not exist yet — `lore review` is an interactive card loop an agent cannot
  drive. `ONB-003` names it as a prerequisite.
- **FR9** It SHALL report what it could not answer, so the gaps steer the next synthesis
  run.
- **FR10** It SHALL NOT create publications, set a price, or deploy anything. Disclosure
  and payment are the other two branches' jobs.

### Non-functional / constraints

- **NFR1** The handoff adds no new Lore command surface beyond an entry point to re-open
  the menu. Deploy and Monetize own their own commands (see their docs).
- **NFR2** No branch is a precondition for another, and the menu must not present them in
  a way that implies otherwise.
- **NFR3** The menu must survive the owner declining everything, twice. Re-prompting an
  owner who chose Nothing is a bug.
- **NFR4** `lore-test` reads private rows and therefore must never be the code path that
  writes a publication — the invariant from `STO-001` (MCP reads publications, never
  private rows) is not weakened by a local eval harness, but nothing in the harness
  should be reusable as a disclosure path either.

## Why a menu and not a wizard

The alternative is chaining onboarding straight into deployment, which is what a
growth-oriented product would do. Two reasons not to:

1. **Deploy and Monetize both require external accounts** — a cloud provider, a wallet,
   Coinbase CDP API keys. Dragging someone into an account-creation flow immediately
   after they consented to a memory-synthesis flow is how you lose them at the second
   consent boundary, and the second boundary is the one that involves money.
2. **The private library is the product.** `MON-001`'s closure and the
   *useful before monetized* principle both point the same way: the owner should be able
   to stop at the end of onboarding and still have gotten the thing.

Test / Eval exists because it converts the most common post-onboarding state — mild
skepticism — into either confidence or corrections, at zero external cost.

## What this intentionally does not do

- **No automatic deployment or pricing.** Every branch past Test / Eval is opt-in, and
  each one asks again before touching an external account.
- **No publication creation.** Deploy exports whatever publications exist; it does not
  create them. That is `XC-002`'s intent-driven publish flow, which is the real
  precondition for a *useful* deployed node.
- **No change to capture.** Blueprint, profile, synthesis scheduling, and backfill are
  unchanged.
- **No new persona or interview.** The blueprint already captured shape; the handoff
  reuses it for voice and does not re-elicit it.

## Open follow-ups

- An owner who deploys with zero publications gets a node that answers nothing. The
  handoff should probably detect that and steer to `XC-002` first — but `XC-002` is
  `in-review` and unbuilt, so the ordering can't be finalized yet.
- `lore handoff` as a command vs. just documenting "invoke the skill again" — the former
  is discoverable, the latter is free. Deferred to implementation.
- Whether `lore-test` should be able to *trigger* a synthesis run to fill a gap it found,
  or only report the gap.

## Related

- `docs/deployment-mvp.md` — the Deploy branch
- `docs/monetization-mvp.md` — the Monetize branch
- `docs/gamified-onboarding.md` — the persona interview that precedes all of this
- Backlog: `ONB-002` (handoff menu), `ONB-003` (`lore-test`)
