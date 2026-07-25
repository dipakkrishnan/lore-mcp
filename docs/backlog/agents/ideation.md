# Ideation

Turn a raw idea — a sentence from the user, a TODO in code, a recurring
complaint, a gap noticed while reading — into a well-formed backlog item.
Read `AGENTS.md` for the shared rules first.

## Inputs

Ideation can be triggered by:
- An explicit ask ("add this to the backlog: ...").
- A scan for signal: recent `git log` messages that mention deferred work,
  `TODO`/`FIXME` comments, open questions in `## Notes` of existing items,
  or gaps noticed while auditing.

## Steps

1. **Restate the idea as a problem**, not a solution. If the input is already
   a solution ("add caching to X"), work backward to what's actually wrong.
2. **Pick the component.** Match against each `docs/backlog/*/README.md`. If
   it genuinely spans components, use `cross-cutting/`.
3. **Check for duplicates first.** Scan the component folder (and
   `INDEX.md`) for an existing item covering the same problem. If found,
   fold new information into that item's `## Notes` instead of creating a
   new one.
4. **Assign the next id.** List files in the component folder, find the
   highest `<PREFIX>-NNN`, use `+1`. Zero-pad to 3 digits.
5. **Copy `_template/item.md`** to
   `<component>/<ID>-<kebab-slug-of-title>.md`.
6. **Fill frontmatter:**
   - `title` — short, imperative, specific enough to disambiguate from
     neighbors.
   - `priority` — a reasonable initial guess (default `P2` if unsure —
     `prioritization` will correct it later).
   - `effort` — a reasonable initial guess.
   - `component`, `status: ideation`, `created`/`updated` = today.
   - `related` — link any items you found in step 3 that are adjacent but
     not duplicates.
   - `blockers` / `dependencies` — only if genuinely known now; it's fine to
     leave these empty and let a later pass fill them in.
7. **Write the body:**
   - `## Problem` — 2-4 sentences. Concrete, not vague ("users can't tell
     why synthesis failed" not "improve error handling").
   - `## Proposed approach` — a rough shape, not a spec. If you genuinely
     don't know, write "unclear — needs investigation" rather than
     inventing plausible-sounding filler.
   - `## Acceptance criteria` — at least one concrete, checkable outcome.
     If you can't state one, the item probably isn't ready to leave
     `ideation` — that's fine, leave it there.
   - `## Notes` — anything else, or leave empty.
8. **If the item is well-formed enough to act on** (clear problem, at least
   one acceptance criterion), set `status: in-review` instead of `ideation`
   so prioritization picks it up. Otherwise leave it at `ideation`.
9. **Do not touch `INDEX.md` directly.** Run (or hand off to) the `audit`
   playbook to fold the new item in.

## What ideation does not do

- Does not assign final priority ranking (that's `prioritization`).
- Does not start implementing anything, even trivial fixes — capture it as
  an item first so it's visible and not lost.
- Does not mark anything `ready` — that transition belongs to
  `prioritization`, which confirms the item is actually unblocked and worth
  doing next.
