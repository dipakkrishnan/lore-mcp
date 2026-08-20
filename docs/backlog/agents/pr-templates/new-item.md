## Summary

- **{{id}}**: {{summary}}

Regenerates `INDEX.md` to include the new row.

## Test plan

- [x] Ran the `audit` playbook's checks (frontmatter validation, id
      sequencing, cross-reference validation, blocker-cycle detection) —
      clean
- [x] Diffed the regenerated table against the item files to confirm no
      hand-editing drift
