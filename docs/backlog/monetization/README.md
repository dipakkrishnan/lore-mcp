# monetization

Prefix: `MON`

Covers: pricing published content, the paid `answer` path, and payment policy.

Two payment paths exist deliberately, and items here should say which they mean:

- **The MPP origin gate is the launch rail.** Payment is enforced in Lore's own
  origin to preserve the local-first architecture. Tracked as GitHub issues
  under epic #25 (#20-#24) rather than as `MON` items — file `MON` items for
  work that epic does not already cover.
- **The Cloudflare/x402 edge is an optional deployment adapter**, not a launch
  dependency (epic #25, Beta decisions). `lore/node/` holds it. `MON-002` onward
  cover it.

Lore owns what is disclosed; a payment rail owns offer, verification, and
settlement. Disclosure is a publication (see `STO-001`), never a memory status —
`external` was retired in PR #19.

Backlog items about pricing UX, payment rails, edge deployment, or disclosure
policy at the point of sale go here.
