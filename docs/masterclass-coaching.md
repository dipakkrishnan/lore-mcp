# Lore as an interactive masterclass, not just an answer service

Lore is currently pitched as paid access to bounded answers: a buyer's agent
discovers a catalog, pays per publication or per question, and gets material
back. That undersells what accumulated firsthand judgment can become. The same
approved publications — the same `private memories -> explicit publication ->
paid answer` pipeline — can also power something closer to a masterclass: a
learner brings their own goal, artifact, or decision, and an agent coaches
them using the owner's judgment, examples, and documented failures, not just
hands them a document.

This note names the shared primitive under that framing, catalogs the use-case
family it opens, and says plainly which of it works today versus what still
needs building.

## The primitive

Every use case below is the same move: **an agent uses an owner's
approved publications to teach, critique, question, rehearse, or guide a
learner toward the learner's own goal** — not to recite the owner's material,
but to apply the owner's judgment to something the learner brought.

That framing rules a few things in and a few things out by construction:

- **In:** the coaching always cites and stays inside approved publications.
  Nothing the agent says can trace back to a private memory the owner never
  published — the same boundary that already governs `discover` and `get`.
- **In:** the learner drives. They bring the artifact, the question, the
  decision. The agent's job is to apply the owner's judgment to *that*, not to
  hold a generic conversation the owner's lore happens to be able to answer.
- **Out:** the agent is not the owner. It has read the owner's *published*
  reasoning; it has not become the owner, does not know what the owner would
  say about something never published, and never implies the owner
  personally reviewed the learner's work or endorses the outcome. See
  "Grounded access is not impersonation" below — this is a hard line, not a
  style preference.

"Masterclass" is working shorthand for this experience, not a committed
product name, and naming it is not a reason to build new infrastructure ahead
of demand. Treat it as a lens for evaluating today's surface and prioritizing
what (if anything) gets built next.

## The use-case family

Eight variants of the same primitive, roughly ordered from "closest to
shipping today" to "needs the most new capability":

1. **Adaptive tutoring.** A learner asks to understand a concept the owner has
   written about; the agent adjusts depth and examples to what the learner
   already knows, drawing only on published material.
2. **Artifact critique.** A learner submits something they made — a plan, a
   pitch, a piece of code, a draft — and the agent critiques it the way the
   owner's publications critique similar work, citing which publication
   informed which note.
3. **Decision rehearsal.** A learner describes a decision they're about to
   make; the agent surfaces the owner's documented reasoning on comparable
   decisions and the tradeoffs the owner weighed, without making the call for
   them.
4. **Case-based teaching.** The agent walks a learner through one of the
   owner's own documented cases or failures, letting the learner apply it to
   their own situation.
5. **Role-play.** The agent takes the position the owner's publications stake
   out on a topic — a negotiation counterpart, a skeptical reviewer — so a
   learner can rehearse against it. This is the use case most likely to be
   mistaken for impersonation; see below.
6. **Office hours.** A standing, low-friction "ask anything in this owner's
   domain" surface — closest to today's `discover`/`get` catalog, reframed as
   an invitation to bring a specific problem rather than browse a manifest.
7. **Curriculum generation.** The agent sequences the owner's publications
   into an ordered path for a stated learning goal, rather than leaving the
   learner to browse the catalog unordered.
8. **Ongoing mentorship.** Coaching across multiple sessions, where the agent
   recalls what a learner previously worked on and threads later publications
   into that continuity.

## The first wedge

**Office hours (6) and artifact critique (2) are the first plausible wedge.**
Both need the least new capability, both have a concrete unit of value a
buyer can judge in one exchange (did this answer my specific problem, did
this critique say something a generic model couldn't), and both fail safely —
a mediocre critique or a shallow answer wastes one payment, not the learner's
trust in a rehearsed decision or a role-played negotiation.

**Decision rehearsal (3), case-based teaching (4), and role-play (5) are
later variants**, not because they're less valuable, but because they need
either the proxy-answer tier (MCP-003) to synthesize across multiple
publications coherently, or enough case density in a given owner's catalog
that "comparable decisions" actually exist to surface. Shipping them ahead of
that produces a coaching experience that's thinner than the pitch.

**Curriculum generation (7) and ongoing mentorship (8) are last**, because
both need state the current stateless, per-call MCP surface doesn't have:
curriculum generation needs an ordering pass over a whole catalog (a
capability, not a call), and mentorship needs to persist what a specific
learner has already covered across sessions — a new data model, not a new
prompt.

## What runs on today's surface, and what doesn't

The shipped surface is exactly two tools: `discover` (free, returns the full
catalog of teasers grouped by topic) and `get` (paid, fetches one publication
verbatim by id). There is no `answer(question)` tool yet — that's `MCP-003`,
still `in-review` and blocked on `MCP-001` and `EVAL-002` at the time of
writing.

- **Office hours (6)** works today, as-is: it's `discover` plus `get`, just
  framed as "bring a problem" instead of "browse a catalog." No new capability
  needed — this is positioning, not product work.
- **Adaptive tutoring (1) and artifact critique (2)** are reachable today if
  the *buyer's own agent* does the synthesis: fetch relevant publications via
  `get`, then reason over them client-side. What's missing isn't a Lore
  capability, it's that nothing today tells the buyer's agent this is a
  reasonable way to use the surface — a documentation gap this note itself
  starts to close, not a code gap.
- **Decision rehearsal (3), case-based teaching (4), role-play (5), and
  ongoing mentorship (8)** need a synthesized, owner-voiced response over
  multiple publications at once — that's squarely `MCP-003`'s `answer`
  tool. Nothing here should be built ahead of that tool landing and clearing
  its own eval bar (`EVAL-002`), because a masterclass framing that's thinner
  than the pitch is worse than no framing.
- **Curriculum generation (7)** needs an ordering/sequencing capability that
  doesn't exist on either tool today — a genuinely new piece of product work,
  not just a new prompt over existing tools.

## Grounded access is not impersonation

Every use case above is described as the agent applying the owner's
*published* judgment — never as the agent *being* the owner. This distinction
has to survive contact with role-play (5) and mentorship (8) in particular,
where the temptation to "speak as" the owner is strongest:

- The agent's outputs are grounded in and cite specific approved
  publications, the same way `answer` (`MCP-003`) is specified to cite
  publication ids today.
- The agent never states or implies the owner personally reviewed the
  learner's specific artifact, decision, or session — only that the owner's
  *published* reasoning informed the response.
- The agent never promises an outcome, endorsement, or personal availability
  on the owner's behalf. "Here's how this owner's documented judgment applies
  to your situation" is in scope; "I've reviewed your plan and approve it" —
  stated as if the owner said it — is not.

This mirrors the constraint already load-bearing in `MCP-003`'s design: the
proxy never reads private memories, and synthesis over private material
happens once, at publish time, where the owner explicitly approves it. A
masterclass framing doesn't loosen that boundary; it's a reason to hold it
more visibly, since "coaching" invites more trust than "search."
