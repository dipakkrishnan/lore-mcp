// The look every yourlore.dev page shares: tokens, the bar, the panels, and the live poll.

export const LIST_URL = "https://yourlore.dev/marketplace.json";
export const BUYER_SKILL = "https://github.com/dipakkrishnan/lore-mcp/tree/main/plugins/lore/skills/lore-buy";
export const DOWNLOAD = "https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.zip";
const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export const escape = (text) =>
  String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const money = (usd) => (usd < 0.01 ? `$${usd}` : Number.isInteger(usd) ? `$${usd}` : `$${usd.toFixed(2)}`);
export const date = (iso) => {
  const parsed = new Date(`${String(iso).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : day.format(parsed);
};
export const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
export const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export const MARK = `<svg class="mark" viewBox="0 0 26 26" aria-hidden="true"><rect x="4.5" y="5" width="17" height="16" rx="3.2" fill="currentColor"/><path d="M3 11.2L4.5 10.6C8 9.2 10.5 12.2 13 10.9S18.5 9.6 21.5 11.2L23 12M3 16.9L4.5 16.3C8 15 10.5 17.8 13 16.6S18.5 15 21.5 16.8L23 17.7" fill="none" stroke="var(--bg)" stroke-width="1.7"/></svg>`;

export const STYLE = `
:root{--bg:#f7f3ea;--surface:#fffdf8;--ink:#1d1f1c;--muted:#6c6f69;--faint:#9a9d96;--line:#e6e1d6;--accent:#244f3d;--accent-soft:#e3ece6;--serif:ui-serif,"New York","Iowan Old Style",Georgia,serif;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--mono:ui-monospace,"SF Mono",Menlo,monospace}
@media (prefers-color-scheme:dark){:root{--bg:#121512;--surface:#1a1e1a;--ink:#ecebe6;--muted:#a3a69f;--faint:#959b94;--line:#2b302b;--accent:#8fc3a6;--accent-soft:#1f2d25}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
main{max-width:1120px;margin:0 auto;padding:20px 16px 72px}
.bar{display:flex;align-items:center;justify-content:space-between;gap:16px;font-size:14px;color:var(--muted);margin-bottom:40px}
.bar nav{display:flex;gap:22px}.bar nav a:hover,.bar nav .on{color:var(--ink)}
.brand{display:inline-flex;align-items:center;gap:8px;color:var(--ink);font-weight:600;font-size:15px}
.mark{width:22px;height:22px;color:var(--accent)}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:22px}
h1{font:500 clamp(36px,6vw,52px)/1.05 var(--serif);letter-spacing:-.02em;margin:0 0 10px}
.lede{color:var(--muted);margin:0;max-width:40em}
.stats{display:flex;flex-wrap:wrap;gap:4px 26px;margin:14px 0 0;padding:0;list-style:none;font-size:13px;color:var(--muted)}
.stats li{display:flex;align-items:baseline;gap:7px}
.stats b{display:inline-flex;font:600 24px/1.2 var(--mono);letter-spacing:-.02em;color:var(--ink);transition:color .6s}
.stats b.tick{color:var(--accent)}
.digit{display:inline-block;height:1.2em;line-height:1.2em;overflow:hidden;vertical-align:top}.digit>span{display:flex;flex-direction:column;transition:transform 1.1s cubic-bezier(.2,.8,.2,1)}.digit i{display:block;font-style:normal;height:1.2em;line-height:1.2em}
@media (prefers-reduced-motion:reduce){.digit>span{transition:none}}
.search{position:relative;flex:0 1 320px}
.search input{width:100%;height:40px;padding:0 14px 0 36px;border:1px solid var(--line);border-radius:10px;background:var(--surface);color:var(--ink);font:14px var(--sans)}
.search input:focus{outline:2px solid var(--accent);outline-offset:1px}
.search svg{position:absolute;left:12px;top:12px;width:16px;height:16px;color:var(--faint)}
.tabs{display:flex;align-items:center;justify-content:space-between;gap:16px;border-bottom:1px solid var(--line);margin-bottom:16px}
.tabs ul{display:flex;gap:22px;margin:0;padding:0;list-style:none;overflow-x:auto;scrollbar-width:none}
.tabs ul::-webkit-scrollbar{display:none}
.tabs li a{display:block;padding:10px 0;color:var(--muted);white-space:nowrap;border-bottom:2px solid transparent;margin-bottom:-1px}
.tabs li a:hover{color:var(--ink)}.tabs li a.on{color:var(--ink);border-color:var(--accent)}
.tabs form{display:flex;gap:6px;flex:none}.tabs button{height:30px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--muted);font:13px var(--sans)}
.tabs select{height:30px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--muted);font:13px var(--sans);padding:0 8px;flex:none}
.tape{display:flex;align-items:center;gap:10px;margin:0 0 28px;font-size:13px;color:var(--muted)}
.tape>span{flex:none;display:inline-flex;align-items:center;gap:6px;color:var(--ink);font-weight:600}
.tape>span:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent);transform:translateY(-1px);animation:pulse 2s ease-out infinite}
@keyframes pulse{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent) 60%,transparent)}70%,100%{box-shadow:0 0 0 7px transparent}}
.tape li.fresh{animation:fresh 2.4s ease-out}
.board li.fresh{animation:flash 2.4s ease-out}
@keyframes flash{0%,30%{background:var(--accent-soft)}100%{background:transparent}}
@keyframes fresh{0%{opacity:0;transform:translateX(-8px);color:var(--accent)}25%{opacity:1;transform:none;color:var(--accent)}100%{color:inherit}}
@media (prefers-reduced-motion:reduce){.tape>span:before,.tape li.fresh,.board li.fresh{animation:none}}
.tape ul{display:flex;gap:22px;min-width:0;margin:0;padding:0;list-style:none;overflow-x:auto;scrollbar-width:none;white-space:nowrap}
.tape ul::-webkit-scrollbar{display:none}
.tape time{font-family:var(--mono);font-size:12px;color:var(--faint);margin-right:6px}
.tape a:hover{color:var(--ink)}
section.tab{margin-bottom:34px}
section.tab>h2{font:600 13px var(--sans);letter-spacing:.02em;color:var(--muted);margin:0 0 12px}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:0;padding:0;list-style:none}
@media (max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.grid{grid-template-columns:1fr}.search{flex-basis:100%}.tabs{flex-wrap:wrap;gap:0}.tabs form{order:-1;width:100%;margin-bottom:6px}.tabs select{flex:1}.tabs ul{width:100%}.row:nth-child(n+3){display:none}}
.card{display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 16px 12px;transition:border-color .15s}
.card:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.card h3{display:flex;align-items:center;gap:10px;font:500 18px/1.25 var(--serif);margin:0 0 12px}
.card h3 a:hover{color:var(--accent)}
.glyph{flex:none;display:grid;place-items:center;width:28px;height:28px;border-radius:8px;background:var(--accent-soft);color:var(--accent);font:600 13px var(--sans)}
.rows{list-style:none;margin:0;padding:0;flex:1}
.row a{display:grid;grid-template-columns:1fr 58px;gap:12px;align-items:center;padding:8px;margin:0 -8px;border-radius:9px}
.row a:hover,.row a:focus-visible{background:var(--accent-soft);outline:none}
.row+.row{border-top:1px solid var(--line)}
.q{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;font-size:14px;line-height:1.4}
.who{display:block;margin-top:2px;font-size:12px;color:var(--faint)}
.row a:hover .q{color:var(--accent)}
.pill{min-width:58px;padding:6px 10px;border:1px solid color-mix(in srgb,var(--accent) 55%,transparent);border-radius:9px;color:var(--accent);font:600 13px var(--mono);text-align:center}
.row a:hover .pill{background:var(--surface)}
.foot-row{display:flex;justify-content:space-between;gap:12px;margin-top:10px;padding-top:10px;border-top:1px solid var(--line);font-size:12px;color:var(--faint)}
.foot-row a{color:var(--muted)}.foot-row a:hover{color:var(--accent)}
.empty{padding:40px 24px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:14px;margin:0 0 34px}
h2.part{font:500 22px var(--serif);margin:48px 0 12px}
.stores{list-style:none;margin:0;padding:0;border:1px solid var(--line);border-radius:14px;background:var(--surface)}
.stores li a{display:grid;grid-template-columns:1fr auto auto;gap:18px;align-items:center;padding:14px 18px}
.stores li+li a{border-top:1px solid var(--line)}
.stores b{font-weight:600}.stores span{font-size:13px;color:var(--muted)}.stores em{font-style:normal;color:var(--accent);font-size:13px;font-weight:600}
.stores li a:hover b{color:var(--accent)}
@media (max-width:640px){.stores li a{grid-template-columns:1fr auto}.stores span{grid-column:1/-1;order:3}}
.panels{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:40px}
@media (max-width:640px){.panels{grid-template-columns:1fr}}
.panel{border:1px solid var(--line);border-radius:14px;padding:18px 20px;font-size:14px;color:var(--muted)}
.panel h3{font:500 17px var(--serif);color:var(--ink);margin:0 0 6px}
.panel p{margin:0 0 8px}.panel a{color:var(--accent);font-weight:600}
code{font:12.5px var(--mono);background:var(--accent-soft);color:var(--ink);padding:2px 6px;border-radius:6px}
.endpoint{display:block;margin:4px 0 12px;padding:8px 10px;overflow-x:auto;white-space:nowrap;user-select:all}
.crumb{font-size:13px;color:var(--muted);margin:0 0 12px}.crumb a:hover{color:var(--ink)}
.offers{list-style:none;margin:28px 0 0;padding:0;display:flex;flex-direction:column;gap:12px}
.offer{display:grid;grid-template-columns:1fr auto;gap:20px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:20px 22px}
.offer h2{font:500 20px/1.3 var(--serif);margin:0 0 8px}.offer h2 a:hover{color:var(--accent)}
.offer blockquote{margin:0 0 10px;padding:2px 0 2px 14px;border-left:3px solid var(--accent-soft);font:16px/1.6 var(--serif)}
.offer .fit{margin:0 0 10px;font-size:14px;color:var(--muted)}
.offer .by{margin:0;font-size:13px;color:var(--faint)}.offer .by a{color:var(--muted)}.offer .by a:hover{color:var(--accent)}
.buy{align-self:center}
.go{display:inline-block;padding:8px 14px;border-radius:9px;background:var(--accent);color:var(--bg);font-weight:600;font-size:14px;white-space:nowrap}
.go:hover{filter:brightness(1.08)}
@media (max-width:640px){.offer{grid-template-columns:1fr}.buy .go{display:block;text-align:center}}
.related{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.related a{display:inline-block;padding:6px 12px;border:1px solid var(--line);border-radius:999px;font-size:13px;color:var(--muted);background:var(--surface)}
.related a:hover{border-color:var(--accent);color:var(--ink)}
.bid-form{display:flex;flex-direction:column;gap:14px;max-width:640px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:18px 20px}
.bid-form label{display:flex;flex-direction:column;gap:6px;font-size:13px;font-weight:600;color:var(--muted)}
.bid-form small{font-weight:400;color:var(--faint)}
.bid-form textarea,.bid-form input,.bid-form select{width:100%;padding:9px 12px;border:1px solid var(--line);border-radius:10px;background:var(--bg);color:var(--ink);font:15px/1.4 var(--sans)}
.bid-form textarea{resize:vertical;font:17px/1.4 var(--serif)}
.bid-form :focus{outline:2px solid var(--accent);outline-offset:1px}
.pair{display:grid;grid-template-columns:140px 1fr;gap:12px}
@media (max-width:640px){.pair{grid-template-columns:1fr}}
.dollar{position:relative}.dollar:before{content:"$";position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted);font:600 15px var(--mono)}
.dollar input{padding-left:26px;font:600 15px var(--mono)}
.bid-form .go{align-self:flex-start;border:0;cursor:pointer;font-family:var(--sans)}
.note{margin:0;font-size:13px;color:var(--muted)}.stats+.note{margin-top:10px}
.error{margin:0;padding:10px 12px;border-radius:10px;background:color-mix(in srgb,#b3261e 12%,var(--surface));color:var(--ink);font-size:14px}
.timeline{list-style:none;margin:0;padding:0 0 0 14px;border-left:2px solid var(--line);font-size:14px}
.timeline li{position:relative;padding:4px 0 10px}
.timeline li:before{content:"";position:absolute;left:-19px;top:11px;width:8px;height:8px;border-radius:50%;background:var(--accent)}
.timeline time{font-family:var(--mono);font-size:12px;color:var(--faint);margin-right:10px}
.timeline a{color:var(--accent);font-weight:600}
.sheet{flex:0 0 auto}.sheet[open]{flex-basis:100%}
.sheet summary{list-style:none;cursor:pointer}.sheet summary::-webkit-details-marker{display:none}
.sheet[open] summary{margin-bottom:14px}
.spread{display:flex;justify-content:space-between;gap:10px;margin:-4px 0 8px;font-size:12px;color:var(--muted)}
.spread b{font:600 13px var(--mono);color:var(--ink)}
.bid{position:relative;display:grid;grid-template-columns:1fr 58px;gap:12px;align-items:center;padding:8px;margin:0 -8px;border-radius:9px}
.bid+.bid{border-top:1px solid var(--line)}
.grid>.empty{grid-column:1/-1;margin:0}
.bid a.q:after{content:"";position:absolute;inset:0;border-radius:9px}
.bid:hover,.bid:focus-within{background:var(--accent-soft)}.bid:hover .q{color:var(--accent)}.bid a:focus-visible{outline:none}
@media (max-width:640px){.sheet{flex-basis:100%}.sheet summary{text-align:center}}
`;

// Instant search over the cards already drawn; without it the form searches on the server.
// The counts and every [data-live] list show as they are, then follow the page's [data-poll] (the marketplace's /marketplace/stats.json by default):
// a count rolls and a list redraws only when its key moves, and items whose data-k is new slide in.
export const SCRIPT = `const col="<span class=\\"digit\\" aria-hidden=\\"true\\"><span>"+"0123456789".split("").map(d=>"<i>"+d+"</i>").join("")+"</span></span>";const roll=(b,v)=>{const t=String(v);b.setAttribute("aria-label",t);if(b.dataset.v===t)return;const was=b.dataset.v;b.dataset.v=t;if(!was)return;const from=was.padStart(t.length,"0").slice(-t.length);b.innerHTML=col.repeat(t.length);const cols=[...b.querySelectorAll(".digit>span")];cols.forEach((c,i)=>{c.style.transition="none";c.style.transform="translateY(-"+from[i]+"0%)"});b.offsetHeight;cols.forEach((c,i)=>{c.style.transition="";c.style.transform="translateY(-"+t[i]+"0%)"});b.classList.add("tick");setTimeout(()=>b.classList.remove("tick"),1600)};const stats=[...document.querySelectorAll("[data-stat]")];stats.forEach(b=>roll(b,b.textContent));const live=[...document.querySelectorAll("[data-live]")];const news=n=>live.forEach(l=>{const k=n[l.dataset.live+"_key"];if(typeof k!=="string"||k===l.dataset.key)return;const had=new Set(l.dataset.key.split("|"));l.dataset.key=k;l.innerHTML=n[l.dataset.live];l.querySelectorAll("[data-k]").forEach(i=>had.has(i.dataset.k)||i.classList.add("fresh"))});const poll=document.querySelector("[data-poll]")?.dataset.poll||"/marketplace/stats.json";(stats.length||live.length)&&setInterval(()=>{document.hidden||fetch(poll).then(r=>r.ok?r.json():null).then(n=>{if(!n)return;stats.forEach(b=>typeof n[b.dataset.stat]==="number"&&roll(b,n[b.dataset.stat]));news(n)}).catch(()=>{})},30000);const f=document.querySelector(".search input[name=q]"),c=[...document.querySelectorAll(".card")],t=[...document.querySelectorAll("section.tab")],e=document.querySelector(".none");f&&f.addEventListener("input",()=>{const q=f.value.trim().toLowerCase();let n=0;for(const k of c){const m=!q||k.dataset.search.includes(q);k.hidden=!m;n+=m}for(const s of t)s.hidden=!s.querySelector(".card:not([hidden])");e&&(e.hidden=n>0)});const s=document.querySelector(".tabs select");s&&s.addEventListener("change",()=>s.form.submit());document.querySelectorAll(".tabs button").forEach(b=>b.remove())`;

const MARKET_AGENTS = `<p>Every market and listing, as JSON:</p><code class="endpoint">${LIST_URL}</code><p>Each store answers <code>discover</code> for free over MCP and <code>get</code> to buy. A browsing agent can also buy by card on any piece's page.</p><a href="${BUYER_SKILL}">Get the buyer skill →</a>`;

/** One page in the site's frame. `section` lights its tab in the bar; `agents` is what the For agents panel tells a reading agent. */
export function page({ title, description, canonical, body, data, section = "markets", alternate = LIST_URL, agents = MARKET_AGENTS }) {
  const tab = (href, name, label) => `<a${section === name ? ' class="on"' : ""} href="${href}">${label}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><meta name="description" content="${escape(description)}">
<link rel="canonical" href="${escape(canonical)}"><link rel="alternate" type="application/json" href="${escape(alternate)}"><style>${STYLE}</style>
${data ? `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>` : ""}</head>
<body><main><div class="bar"><a class="brand" href="/">${MARK}Lore</a><nav>${tab("/marketplace", "markets", "Markets")}${tab("/bids", "bids", "Bids")}<a href="/">Get Lore</a></nav></div>
${body}
<div class="panels"><section class="panel"><h3>For agents</h3>${agents}</section>
<section class="panel"><h3>Sell what you know</h3><p>Lore turns what you've already written into pieces you approve, then opens a store that pays you directly.</p><a href="${DOWNLOAD}">Download for macOS →</a></section></div>
</main><script>${SCRIPT}</script></body></html>`;
}
