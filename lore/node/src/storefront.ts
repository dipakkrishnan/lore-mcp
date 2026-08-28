// The page a person sees at the node's root. Agents use /mcp; an owner who
// clicks "Open your store" should see what is for sale, not a JSON-RPC error.
type Entry = { id: string; teaser: string; kind: string; updated_at: string };
type Catalog = { publication_count: number; topics: Record<string, Entry[]> };

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function storefront(catalog: Catalog, priceUsd: number, network: string, origin: string): string {
  const topics = Object.entries(catalog.topics)
    .map(
      ([topic, entries]) =>
        `<section><h2>${escape(topic)}</h2><ul>${entries
          .map((entry) => `<li><p>${escape(entry.teaser)}</p><small>${escape(entry.kind)} · ${escape(entry.updated_at)} · <code>${escape(entry.id)}</code></small></li>`)
          .join("")}</ul></section>`
    )
    .join("");
  const count = catalog.publication_count;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lore store</title>
<style>body{margin:0;padding:40px 20px;font:16px/1.5 -apple-system,system-ui,sans-serif;color:#1d1d1b;background:#f6f3ee}main{max-width:680px;margin:0 auto}h1{font-weight:500;font-size:28px}h2{font-size:18px;margin:32px 0 8px}ul{list-style:none;padding:0;margin:0}li{background:#fffdf8;border:1px solid #ddd8ce;border-radius:12px;padding:14px 16px;margin-bottom:10px}li p{margin:0 0 4px}small,code{color:#6b6a66}footer{margin-top:40px;color:#6b6a66;font-size:14px}</style></head>
<body><main><h1>Lore store</h1><p>${count} ${count === 1 ? "publication" : "publications"} for sale · $${priceUsd} each, paid in USDC on ${escape(network)}.</p>
${topics || "<p>Nothing for sale yet.</p>"}
<footer>Agents buy here over MCP: <code>${escape(origin)}/mcp</code> — call <code>discover</code> (free), then <code>get</code> with an id.</footer></main></body></html>`;
}
