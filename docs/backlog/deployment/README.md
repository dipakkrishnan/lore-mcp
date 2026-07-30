# deployment

Prefix: `DEP`

Covers: the `lore-deploy` skill, the cloud-provider interface behind it, the
publication export bundle, and the per-provider hosting paths (AWS, Cloudflare,
later others). Anything about making a Lore node *reachable* by another agent's
MCP client.

The boundary against neighbouring components:

- **`monetization/` (`MON`)** owns whether an answer is *paid*. Hosting and
  payment are orthogonal here — a deployed node may be free, and a loopback node
  may charge. Payment configuration items go there, not here.
- **`mcp-server/` (`MCP`)** owns the protocol surface and tool behavior of
  `lore/mcp.py` itself. This folder owns getting that surface onto infrastructure
  the owner controls.
- **`store-import/` (`STO`)** owns the `publications` table. This folder owns
  exporting a bounded copy of it and the staleness that copying introduces.

Backlog items about provider CLIs, credentials, buckets, functions, bundle
export/refresh, or teardown go here.
