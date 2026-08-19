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
- An open GitHub issue not yet cataloged — see "Cataloging a GitHub issue"
  below for the extra steps this input needs.

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
10. **If a PR is warranted for the new item(s)**, render its body from
    [`pr-templates/new-item.md`](./pr-templates/new-item.md) via
    [`render_pr_body.py`](./render_pr_body.py) rather than composing it
    freehand.

## Cataloging a GitHub issue

Same steps as above, with the item's frontmatter and two extra actions
layered on. Requires the `gh` CLI authenticated with at least triage access
on the target repo.

1. **Get the issue.** `gh issue view <number> --repo <owner>/<repo> --json
   number,title,body,url,labels`.
2. **Dedupe before creating anything.** Search every item file's
   `github_issue` field for this issue's URL (not just items in the likely
   component — an earlier pass may have filed it elsewhere). If a match
   exists, skip straight to step 6 (comment + label) using the existing
   item(s) — never create a second set of items for an already-cataloged
   issue.
3. **Split if the issue bundles unrelated asks.** Most issues become one
   item; if an issue genuinely describes several distinct pieces of work
   (different components, or independently completable), create one item
   per piece rather than one oversized item — normal component/scope rules
   from the main steps still apply to each.
4. **Follow the main steps (1-8)** for each item, with one addition: set
   `github_issue: <issue URL>` in the frontmatter (not left `null`), and add
   a line to `## Notes` noting it was cataloged from that issue.
5. **Run (or hand off to) `audit`** to fold the new item(s) into `INDEX.md`
   before touching GitHub — don't comment/label until the item(s) are
   actually saved, since the comment links to them.
6. **Comment on the issue**, linking every item created or matched in step 2:
   ```sh
   gh issue comment <number> --repo <owner>/<repo> --body "Picked up in the backlog: <item id>(s), e.g. \`STO-004\` — <relative path(s)>."
   ```
7. **Label the issue** `backlog-cataloged` so it's never reprocessed:
   ```sh
   gh label create backlog-cataloged --repo <owner>/<repo> \
     --description "Filed as a lore-mcp backlog item" --color 0E8A16 2>/dev/null || true
   gh issue edit <number> --repo <owner>/<repo> --add-label backlog-cataloged
   ```
   The label-create line is idempotent (ignore "already exists"); the
   edit line is what actually matters and must not be skipped.

If a PR is warranted for the cataloged item(s), render its body from
[`pr-templates/github-issue-cataloged.md`](./pr-templates/github-issue-cataloged.md)
via [`render_pr_body.py`](./render_pr_body.py) instead of `new-item.md` —
it links back to the source issue.

## What ideation does not do

- Does not assign final priority ranking (that's `prioritization`).
- Does not start implementing anything, even trivial fixes — capture it as
  an item first so it's visible and not lost.
- Does not mark anything `ready` — that transition belongs to
  `prioritization`, which confirms the item is actually unblocked and worth
  doing next.
