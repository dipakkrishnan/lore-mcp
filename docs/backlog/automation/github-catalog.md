# GitHub issue catalog (scheduled, opt-in: issue scan -> ideation -> audit)

Target repo: **`dipakkrishnan/lore-mcp`** (the upstream repo where issues are
filed; the `shanedasbach/lore-mcp` fork has Issues disabled). This job posts
comments and labels on that repo — visible to its maintainer and any other
contributors — so treat it as opt-in like `delivery`, and confirm you have
at least **triage** access there before enabling it (`gh api
repos/dipakkrishnan/lore-mcp --jq .permissions`). Without at least `triage:
true`, the label/comment steps will fail.

Run these steps, in this repo's root:

1. **List open, uncataloged issues:**
   ```sh
   gh issue list --repo dipakkrishnan/lore-mcp --state open \
     --search '-label:backlog-cataloged' --json number,title,url
   ```
2. **For each issue returned**, read `docs/backlog/agents/ideation.md`'s
   "Cataloging a GitHub issue" section and follow it exactly against that
   issue and `--repo dipakkrishnan/lore-mcp`: dedupe against existing
   `github_issue` values first, create one or more items, run `audit` to
   save them into `INDEX.md`, then comment on the issue linking to the new
   item(s) and add the `backlog-cataloged` label.
3. **Process issues one at a time**, saving and committing each issue's
   item(s) before commenting/labeling that issue — don't batch all item
   creation first and all GitHub writes after, since a mid-run failure
   should leave completed issues fully done and untouched issues fully
   untouched, not a mix of "items exist but issue not labeled."
4. **If an issue doesn't map to any real, well-formed piece of work** (e.g.
   it's a question, already resolved, or a duplicate of another issue),
   still comment explaining why no item was filed and still add
   `backlog-cataloged` — the label means "processed," not "accepted."
5. **Run `docs/backlog/agents/audit.md` once more** at the end to make sure
   `INDEX.md` reflects everything created this run.

Why this order: dedup must happen per-issue before creating anything (an
earlier issue in the same run could already cover a later one), and each
issue's GitHub-visible actions (comment, label) must not fire until that
issue's own items are actually saved.

Commit the resulting backlog changes with a message listing which issues
were cataloged into which item ids. Do not push, and do not comment/label
issues that were already labeled `backlog-cataloged` even if you notice
their items look incomplete — that's a `prioritization`/`audit` finding to
report, not a reason to re-process the issue.
