---
id: APP-201
title: One sheet for setting values, and a quieter sidebar
priority: P1
effort: M
component: desktop-app
status: in-review
related: [APP-200, APP-118, APP-105, APP-019]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-14
updated: 2026-10-14
---

## Problem

The owner looked at the new Automations tab and found the "New automation" sheet
janky: a small modal under a heavy grey overlay, the Lore mark in its header, a
textarea with a resize grip, and three native selects in a row. Every other sheet
that sets a value (price, connectors, paste, feedback) was built its own way, so
none of them look alike. The sidebar was busy too: FAQ and Settings sat in the
main nav, with a lone "Report Feedback" link floating above the account row.

## Proposed approach

One form-sheet component in the renderer, modelled on ChatGPT's scheduled-task
sheet and Claude Cowork:

- an optional borderless title, then a large rounded prompt that grows as it
  fills, with no resize grip;
- grouped inset rows (label left, value right) under small muted headings. A
  select row shows the value and a chevron, with the real native `<select>` laid
  transparently over the row. A text row edits in place on its right;
- a footer with a muted note on the left and the buttons on the right. The
  primary stays disabled until the form is valid;
- a native modal, so Escape closes it. ⌘↩ submits from any field.

New automation and Change time move onto it, as Title, Prompt, then a Schedule
group (Repeat, On for a weekly rhythm only, At), offering only the rhythms
`lore/automation.py` runs. A routine record gains an optional `title`. The
sentence stays what Lore does.

Then declutter the sidebar. The main nav is Today, Memories, For Sale,
Connectors and Automations. The account row opens a native popover menu with
Settings (⌘,), Help & FAQ, Report feedback, then who is signed in.

## Acceptance criteria

- [x] New automation and Change time use the shared sheet. A title is optional
      and defaults to the sentence.
- [x] Price and free copies, the connector sheets (choose a vault or file, feed
      address, sign in, manage, disconnect), paste-to-sell and Report feedback
      use the same sheet, with no change in what they do.
- [x] The sidebar shows five places. Settings, the FAQ and feedback are in the
      account menu, and ⌘, still opens Settings.
- [x] Every route that landed on the FAQ or Settings still lands there.
- [x] Edge walks updated, with assertions at least as strong as before.

## Notes

Oct 14, built:
- The memory sheet keeps its own layout. It reads a document and edits it in
  place, which is not a set of values.
- Approval cards and the payout card in the agent thread are inline cards, not
  sheets, and are unchanged.
- The desktop app has no support-email editor yet (`lore support-email` is
  CLI-only), so there was nothing to move.
- The price editor was inline on For Sale. It is now the price sheet, opened
  over For Sale from every Change price, as before. A refused price is said in
  the sheet instead of as a notice behind it.
- The app has no dark theme, so there is no dark variant to check.
