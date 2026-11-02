---
name: design-review
description: Hold any Lore UI change (desktop app or website) to docs/design-principles.md, Lore's Linear-standard design rules. Use before writing or reviewing UI, when the user says "design review", "does this match Linear", "check the UX", or when a backlog item touches app/desktop/src or site/.
---

# Design review

1. Read `docs/design-principles.md` in full. It overrides any older pattern in the code.
2. Before building, find the Linear convention for the screen (inbox, list, issue page, settings, command menu) and
   name it in your plan. Reuse a shared selector in `app/desktop/src/styles.css`; add tokens, never raw values.
3. Screenshot every changed screen in dark mode on real data: the app at 1440×900, from a dev launch whose `LORE_HOME`
   is a copy of `~/.lore` (never the owner's live window), and the site at 1440 and 390 wide.
4. Walk sections 1–9 of the principles against each screenshot and list every break as `screen · element · rule`.
5. Fix every break, or list it under "Design gaps" in the PR body with a backlog id. Attach the screenshots.
