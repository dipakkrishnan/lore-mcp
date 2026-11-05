# Lore design principles

Lore's app and website are held to Linear's standard: dark, quiet, dense, keyboard-first, every object a page.
These rules are checkable. A UI change that breaks one doesn't merge, whoever wrote it.
The `design-review` skill walks this list against screenshots.

When in doubt, open Linear and copy its convention. Don't invent a third design.

## 1. Surfaces

- **Dark first.** Design and review in dark. Light mode is derived from the same tokens and must not need its own fixes.
- **One canvas.** The sidebar and the main area sit on the same near-black ramp; the sidebar is at most one step lighter.
  No macOS vibrancy gray behind the sidebar.
- **Hairlines, not boxes.** Content sits on the canvas, with sections split by a 1px line. A card is only for an object
  that floats over others (a menu, a dialog, a toast, a peek). No card inside a card. No boxed group of rows.
- **Elevation is shadow plus one surface step**, never a colored border.

## 2. Type

- **One family in the product: the system sans** (SF Pro, Inter on the web). No serif in app chrome, lists, titles or
  dialogs. The website may use one display face for its hero line only.
- **Five sizes:** 11 (meta), 12 (secondary), 13 (body and rows), 15 (page title in a header), 20 (page title on an
  empty canvas). The website adds its display size. Nothing else.
- **Hierarchy comes from weight and color (primary, secondary, tertiary)**, not size jumps.
- **Sentence-case group labels**, 12px, tertiary. No letter-spaced ALL CAPS eyebrows.

## 3. Tokens

- Colors, radii, spacing, shadows and durations come from variables in `styles.css` `:root`. No raw hex or px values in a
  component rule.
- **Radii:** 4 (chips, inputs), 6 (buttons, rows), 8 (menus, popovers), 12 (dialogs). Pills (999) only for status chips.
- **Spacing on a 4px grid.** Row height 32–40px. Page gutter 24–32px.
- **The accent marks one thing:** the primary action or a live state. A screen has at most one filled accent button.
  The sidebar's New is not that button.

## 4. Lists are rows

- **Every collection is a list of one-line rows:** status glyph, title, then right-aligned meta (source icon, date,
  price, count). Never a second line of description in a list.
- **Group by a flat header row** (label + count), collapsible. Don't box groups as cards.
- **Row actions appear on hover** or in the row's `…` menu. No column of identical "Take down" buttons.
- **Filters are text tabs or a display menu** (Linear's "All / Active / Backlog"), not segmented pills with count badges.
- **Titles are written for people.** A slug title-cased ("Lore Oct30 Bids Proposal") is a bug.

## 5. Every object is a page

- **A memory, piece, collection, bid, connector and automation each open as a full page** in the main area, with the
  sidebar still showing and ↑/↓ to step through the list. Use a modal only for a short decision.
- **Page layout:** title, body, then **Activity**: a timeline of what happened, newest last ("Captured from Claude Code ·
  Nov 1", "Drafted for sale", "Approved at $5", "Sold to an agent · $5"). Properties (status, source, collection,
  price, views) sit in a right column or a property row, never in prose.
- **Agent work shows up as activity on the object**, the way Linear's agent writes "Worked for 10 sec · Changed 2 files".
  Lore reading Granola, drafting a piece, or answering a bid lands in the activity timeline. No separate chat transcript
  dumped into a page.

## 6. Inbox, not dashboard

- **The home view is an Inbox:** one row type for everything that needs the owner (a draft ready to approve, a check-in
  question, a sale, a bid that matches what they know, a connector that broke). Each row has one verb.
- **No greeting, no date hero, no stack of different cards.** When it's empty it says "You're all caught up" and nothing
  else.
- **Capture is a command** (⌘K, the New menu, or a composer pinned at the bottom of a page), not a hero input.

## 7. Navigation

- **The sidebar holds places, not actions:** Inbox, Inventory, Bids, Connectors. Automations live in Settings
  and in ⌘K. Settings, Help and sign-out sit in the workspace menu at the top-left.
- **One status model per object.** A memory is Private, Draft, On sale or Taken down: exactly one, so the filter counts
  add up to the total.
- **One way to create each thing.** New (⌘N) lists Memory, Collection and Automation; ⌘K reaches the same commands.
  No second "Add" button in a page header, with one exception: **Talk it through** on Inbox and Inventory, the voice
  way in, because people don't use dictation they can't see (owner, Nov 5; APP-290).
- **New is a small compose icon** next to search, not a full-width filled button.
- **⌘K does everything.** It finds objects and runs every command ("Connect Granola", "Set price", "Go to Inventory").
  Every menu item shows its shortcut. ↑/↓ or J/K move through any list; Enter opens; Esc backs out.

## 8. Controls and copy

- **Icons:** 16px, 1.5 stroke, one set. A product's real mark only where the product itself is meant.
- **Status is a glyph** (Linear's status circles), plus a word only where the glyph is ambiguous.
- **Settings rows:** label and one-line description on the left, one control on the right (a toggle, a select, or one
  button). No paragraph per row. No row with a pill, a link and a button.
- **Copy is noun labels and short verbs** that a non-technical seller understands. No protocol names (Base, Worker,
  mainnet) and no cute phrasing. Explanations live in Help, not under every control.
- **Menus are single-line rows:** 16px icon, 13px label, shortcut on the right. No bold title with a description line.

## 9. Website: show, don't claim

- **Every claim has a live object behind it:** a real bid with its dollar amount, a real piece with its sample, a real
  sale receipt. No illustrated app mock with an invented sale.
- **Lead with value, then demand.** The first screen answers two questions with real objects: what Lore does for me
  even if I never sell (my agents remember what I've taught them, across apps), and who wants what I know, for how much
  (live bids). Privacy and connectors come after the visitor wants in.
- **One real example, end to end.** A real conversation, the private memory Lore kept, the excerpt the owner approved,
  the buyer's question and the paid answer. Anything illustrative says so.
- **One nav and one name for each place** across yourlore.dev, store pages and piece pages: Bids, Markets, Download.
- **Store pages look like yourlore.dev.** A seller's page is a list of rows (question, sample, price), not a pill cloud
  of topics over boxed cards.
- **Human pages don't show API docs inline.** The agent door is `/llms.txt`, the JSON twins, and one "For agents" link.
- **Mobile first.** 390px wide with no horizontal scroll and nothing clipped.

## How to check

1. Screenshot every changed screen in dark mode at 1440×900 (app) or 1440 and 390 wide (site), on real data (a copy of
   `~/.lore`, never the owner's live window).
2. Walk sections 1–9 against each screenshot. List every break with the screenshot and element.
3. Fix it, or name it as a known gap in the PR with a backlog id. "Matches the old screen" is not a defense.
