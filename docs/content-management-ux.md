# Content management UX

Design notes for [issue #6](https://github.com/dipakkrishnan/lore-mcp/issues/6).

## The problem is the funnel, not the terminal

The issue frames this as an interface problem: reviewing 50 memories one card at a
time in the terminal is tedious. That is true, but a nicer surface would still ask
for 50 decisions.

`lore review` collapses three separable decisions into one keystroke:

1. **Capture** — does this enter Lore at all?
2. **Retention** — keep it, or discard it?
3. **Disclosure** — may a paying stranger see a derivative of this?

Decisions 1 and 2 are cheap, reversible, and largely automatable. Decision 3 is
expensive, requires real judgment, and is irreversible: once `answer` returns a
derivative to a paying caller, it is out. The reason 50 memories is exhausting is
not the card loop — it is that the flow demands the expensive decision on every
item, including the ones where it is obviously irrelevant.

Almost nothing should be `external`. Every proposal in the issue is a different way
of decoupling these three decisions: make capture and retention automatic, and make
disclosure rare and deliberate.

Two numbers to design against:

- **Owner decisions per week: under 5**, and independent of session volume.
- **Irreversible disclosure errors: zero.**

The second constrains the first. Any design that lowers decision count by defaulting
disclosure permissive has failed, not succeeded.

## Where each proposal lands

**Proposal 1 — right instinct, wrong default.** Passive capture is correct. But it
defaults decision 3 to permissive, and that is the one decision that must never
default permissive. The salvage is to keep everything as `private` rather than
`external`. `store.py` already inserts new memories as `pending`; a "keep everything"
default is a small change plus letting `lore review` operate over the private pool.
This is available immediately and requires no new concepts.

**Proposal 2 — unknown resolved, wrong grain.** The open question was whether tagging
is possible. It is: the `UserPromptSubmit` hook receives raw prompt text, so `#lore`
or `#nolore` in an ordinary prompt is readable without any agent support. The flaw is
grain. A session produces one durable claim and forty turns of noise; tagging the
session tags the noise too. Tags are a good hint channel — priority, routing,
suppression — and a poor final-decision channel.

**Proposal 3 — largely built.** `automation.py` plus the native scheduled task is
already the cadence. Only the accept/reject surface is missing. But batching the same
N decisions onto a nicer screen does not change N. Its real value is discovery, below.

**Proposal 4 — mechanism, not policy.** Hooks do not decide anything. Their worth is
that they make Proposals 2 and 5 implementable, and that they open a read path Lore
does not currently have.

**Proposal 5 — the only structural fix.** It is the one proposal where review volume
is independent of capture volume: 5,000 captures can still mean three decisions. Its
weakness is discovery — the owner has to remember something exists in order to ask
for it.

## Combined design

Each proposal contributes one part.

### Capture — Proposals 4 and 1

Ship a Claude Code plugin containing `hooks/hooks.json` rather than writing into the
user's `~/.claude/settings.json`. This resolves Proposal 4's largest objection: Lore
never edits a config it does not own, and uninstalling the plugin fully removes the
integration.

A `SessionEnd` hook with `async: true` keeps capture off the session's critical path,
so a slow or broken capture cannot degrade the user's agent session.

Captured material lands in a **separate `captures` table**, not a fifth value of
`status`.

This distinction is a security property, not a modeling preference. `answer` returns
rows matching `status='external'`. If staging were a status, every query that filters
on status becomes a potential leak, and safety depends on getting a `WHERE` clause
right in every present and future code path. With a separate table, disclosing a
capture requires a join that someone would have to write deliberately. Make the unsafe
thing impossible to express, rather than merely absent.

### Transcript boundary

The README commits to not reading conversation transcripts. Capture needs session
content. The resolution is a `type: "prompt"` hook at `SessionEnd`: a single-turn
model call that distills the session into candidate claims. Raw transcript text is
never stored and never indexed.

This preserves the substance of the commitment — Lore holds owner-reviewable claims,
not conversation logs — while still capturing content that would otherwise be lost.
It also degrades safely: if the distillation call fails, nothing is captured, and
nothing is corrupted.

Note that `transcript_path` arrives in every hook payload whether Lore uses it or not.
Deliberately not reading it is the design.

### Promotion — Proposal 5

    lore add "what I learned about x402 pricing"

Search the captures table with the existing FTS5 index, cluster the matches,
synthesize a single candidate, and present one approval card. On approval the
candidate is inserted into `memories` with its originating capture IDs retained as
provenance, so `answer` can cite evidence for a synthesized claim.

Review becomes proportional to what the owner wants to publish rather than to how
much they generated.

### Discovery — Proposal 3, repurposed

Proposal 5's hole is that the owner must know to ask. The fix is a periodic digest
that ranks captures by cross-session recurrence and distinctiveness — bm25 and IDF,
both of which FTS5 already provides — and surfaces the top few:

> You have explained this to four different agents this month. Publish it?

This is Proposal 3's cadence doing discovery instead of review. It produces a handful
of high-value prompts per week rather than a queue proportional to session count.

### Read path

`SessionStart` hooks can return `additionalContext`, which means hooks are
bidirectional. Lore can inject the owner's relevant context into new sessions rather
than only capturing from them.

This is not in the issue, and it is probably the highest-leverage item here for two
reasons. It makes Lore useful before any monetization exists, which is what sustains
the capture habit that everything else depends on. And it creates a much better moment
to ask for a disclosure decision — immediately after a memory demonstrably helped,
rather than at card 37 of 50.

## Trap: do not put capture on the paid MCP surface

`type: "mcp_tool"` hooks can call a connected MCP server directly, which makes it
tempting to add a `capture` tool to `lore serve` and let the hook call it.

Do not. `lore serve` is the public, paid surface, intended to sit behind a Cloudflare
tunnel and Monetization Gateway. Adding owner-private write operations to that server
puts them one routing mistake away from public reachability. Keep capture on the CLI
and stdio side, or behind a separate loopback-only server.

## Sequence

1. Change the capture default to `private` and let `review` work the private pool.
   Small, immediately useful, no new concepts. (Proposal 1, corrected)
2. Add the `captures` table and `lore capture --stdin`. No hook yet; verify the data
   model with manual invocation first.
3. Ship the plugin with the `SessionEnd` distillation hook. (Proposal 4)
4. Add `lore add "<description>"` promotion. (Proposal 5)
5. Add the discovery digest. (Proposal 3, repurposed)
6. Add the `SessionStart` read path, and use it as the disclosure prompt moment.

Steps 1 and 2 are independently useful and do not commit to the rest.

## Open questions

- Retention and eviction policy for the captures table.
- Whether promotion yields one candidate or a set the owner narrows.
- How the distillation prompt hook's model is chosen and what it costs per session.
- Codex parity. Codex was not installed on the machine this was drafted against, and
  its hook surface is thinner than Claude Code's. Claude-first is viable; matching
  Codex is a separate question.
- Whether tags from Proposal 2 set priority only, or can also suppress capture
  entirely for a session.
