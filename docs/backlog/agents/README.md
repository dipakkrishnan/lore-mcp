# Backlog PR templates

Reference bodies for the recurring shapes a backlog PR takes, so opening one
is filling in a template instead of composing prose from scratch each time
(XC-007). Every backlog PR title still needs a leading backlog id per
`.github/workflows/pr-title.yml` (XC-010) — these templates only cover the
body.

| Shape | Template | Used by |
|---|---|---|
| A new item was filed (`ideation` output) | [`new-item.md`](./new-item.md) | `ideation.md` |
| An item was cataloged from a GitHub issue | [`github-issue-cataloged.md`](./github-issue-cataloged.md) | `ideation.md`, "Cataloging a GitHub issue" |
| An item reached `completed` | [`completed-item.md`](./completed-item.md) | `implementation.md` |
| Only `audit` ran (findings and/or a regenerated `INDEX.md`, no item completed) | [`index-regenerated.md`](./index-regenerated.md) | `audit.md` |

## Rendering one

`render_pr_body.py` fills a template's `{{placeholder}}` tokens from
`--var KEY=VALUE` pairs and prints the finished body. It fails loudly — a
typo'd template name or a missing variable is a nonzero exit with a message
on stderr, never a body with an unfilled `{{...}}` left in it.

```sh
python3 docs/backlog/agents/render_pr_body.py --template completed-item \
    --var problem="No backlog playbook documents opening a PR for its own output." \
    --var changes="Added pr-templates/ and render_pr_body.py; linked them from the three playbooks that produce PR-worthy output." \
    --var test_plan="- [x] \`uv run python -m unittest discover -s tests\` — clean"
```

Compose straight into `gh pr create`:

```sh
gh pr create --title "XC-007: ..." --body "$(python3 docs/backlog/agents/render_pr_body.py \
    --template completed-item --var problem="..." --var changes="..." --var test_plan="...")"
```

## Adding a template

Add `<shape>.md` here with `{{placeholder}}` tokens wherever the body must
vary; everything else is fixed boilerplate. `render_pr_body.py` derives the
required variables from whatever `{{...}}` tokens the file contains — no
separate list to keep in sync. Then link the new template from whichever
playbook(s) in `../` produce that shape of PR.
