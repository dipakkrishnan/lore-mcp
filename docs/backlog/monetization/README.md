# monetization

Prefix: `MON`

Covers: pricing an answer (`lore price`), the `lore/payments/` gate, and the x402
payment path in front of the `answer` tool. Lore configures an existing rail — it
builds no payment network, holds no funds, and takes no fee.

Payment is enforced **in-process at the MCP layer**, not at an edge gateway.
`MON-001` covered the Cloudflare Tunnel / Monetization Gateway path and was closed
obsolete on 2026-07-29; read its closure note before proposing anything
gateway-shaped. The `external` memory status that item priced against is also
retired — disclosure now happens only through owner-approved publications
(`STO-001`), and payment gates *access* to those publications without ever widening
the set.

The boundary against `deployment/` (`DEP`): payment and hosting are orthogonal. A
deployed node may be free, and a loopback node may charge. Where a node runs is a
`DEP` concern; whether an answer costs money is a `MON` concern.

Backlog items about pricing UX, the payment gate, payout configuration, or payment
policy go here.
