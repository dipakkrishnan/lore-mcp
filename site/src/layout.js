// The look every yourlore.dev page shares: tokens, the bar, rows, the footer, and the live poll.
// Dark first; light is the same tokens redefined. One sans family; the serif is the home hero's display line only.

export const LIST_URL = "https://yourlore.dev/marketplace.json";
export const DOWNLOAD = "https://github.com/dipakkrishnan/lore-mcp/releases/latest/download/Lore-macOS-arm64.zip";
export const REPO = "https://github.com/dipakkrishnan/lore-mcp";
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

const DARK = "--bg:#0e100f;--surface:#151816;--raise:#1b1f1c;--ink:#e9eae7;--muted:#a3a8a2;--faint:#868b85;--line:#232724;--accent:#8fc3a6;--accent-ink:#0e100f;--accent-soft:#18241e;--shadow:0 8px 24px rgba(0,0,0,.5);color-scheme:dark";
const LIGHT = "--bg:#fbfbfa;--surface:#f3f4f2;--raise:#ffffff;--ink:#1a1c1a;--muted:#585d57;--faint:#6c716b;--line:#e4e6e3;--accent:#2b6a4d;--accent-ink:#ffffff;--accent-soft:#e6f0ea;--shadow:0 8px 24px rgba(20,24,20,.12);color-scheme:light";

export const STYLE = `
:root{${DARK};--sans:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;--display:ui-serif,"New York","Iowan Old Style",Georgia,serif;--mono:ui-monospace,"SF Mono",Menlo,monospace;--t11:11px;--t12:12px;--t13:13px;--t15:15px;--t20:20px;--t-display:clamp(34px,5.4vw,52px);--r4:4px;--r6:6px;--r8:8px;--r12:12px;--pill:999px;--s1:4px;--s2:8px;--s3:12px;--s4:16px;--s5:20px;--s6:24px;--s8:32px;--s12:48px;--s16:64px;--row:40px;--fast:.15s}
@media (prefers-color-scheme:light){:root:not([data-theme="dark"]){${LIGHT}}}
:root[data-theme="light"]{${LIGHT}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:var(--t15)/1.55 var(--sans);-webkit-font-smoothing:antialiased}
a{color:inherit;text-decoration:none}
main{max-width:1040px;margin:0 auto;padding:var(--s4) var(--s4) var(--s16)}
@media (min-width:720px){main{padding-inline:var(--s8)}}
a:focus-visible,button:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:var(--r4)}
.bar{display:flex;align-items:center;justify-content:space-between;gap:var(--s4);height:48px;margin-bottom:var(--s4);font-size:var(--t13);color:var(--muted)}
.bar nav{display:flex;gap:var(--s4)}.bar nav a:hover,.bar nav .on{color:var(--ink)}
.brand{display:inline-flex;align-items:center;gap:var(--s2);color:var(--ink);font-weight:600;font-size:var(--t15)}
.mark{width:20px;height:20px;color:var(--accent)}
h1{font:600 var(--t20)/1.3 var(--sans);margin:0 0 var(--s2)}
h2.part{font:600 var(--t15)/1.4 var(--sans);margin:var(--s8) 0 var(--s2)}
.lede{color:var(--muted);margin:0;max-width:40em}
.note{margin:0;font-size:var(--t13);color:var(--muted);max-width:44em}
.meta{font-size:var(--t13);color:var(--faint)}
.crumb{font-size:var(--t13);color:var(--muted);margin:0 0 var(--s3)}.crumb a:hover{color:var(--ink)}
.go{display:inline-flex;align-items:center;justify-content:center;gap:var(--s2);height:36px;padding:0 var(--s4);border:0;border-radius:var(--r6);background:var(--accent);color:var(--accent-ink);font:600 var(--t13) var(--sans);white-space:nowrap;cursor:pointer}
.go:hover{filter:brightness(1.08)}
.quiet{display:inline-flex;align-items:center;justify-content:center;height:36px;padding:0 var(--s4);border:1px solid var(--line);border-radius:var(--r6);background:transparent;color:var(--ink);font:500 var(--t13) var(--sans);cursor:pointer}
.quiet:hover{background:var(--surface)}
.head{display:flex;align-items:flex-end;justify-content:space-between;gap:var(--s4);flex-wrap:wrap;margin-bottom:var(--s5)}
.stats{display:flex;flex-wrap:wrap;gap:var(--s1) var(--s5);margin:var(--s2) 0 0;padding:0;list-style:none;font-size:var(--t13);color:var(--muted)}
.stats li{display:flex;align-items:baseline;gap:6px}
.stats b{display:inline-flex;font:600 var(--t15)/1.2 var(--sans);font-variant-numeric:tabular-nums;color:var(--ink);transition:color .6s}
.stats b.tick{color:var(--accent)}
.digit{display:inline-block;height:1.2em;line-height:1.2em;overflow:hidden;vertical-align:top}.digit>span{display:flex;flex-direction:column;transition:transform 1.1s cubic-bezier(.2,.8,.2,1)}.digit i{display:block;font-style:normal;height:1.2em;line-height:1.2em}
@media (prefers-reduced-motion:reduce){.digit>span{transition:none}}
.tabs{display:flex;align-items:center;justify-content:space-between;gap:var(--s4);border-bottom:1px solid var(--line);margin-bottom:var(--s2)}
.tabs ul{display:flex;gap:var(--s5);margin:0;padding:0;list-style:none;overflow-x:auto;scrollbar-width:none}
.tabs ul::-webkit-scrollbar{display:none}
.tabs li a{display:block;padding:var(--s2) 0;font-size:var(--t13);color:var(--muted);white-space:nowrap;border-bottom:1px solid transparent;margin-bottom:-1px}
.tabs li a:hover{color:var(--ink)}.tabs li a.on{color:var(--ink);border-color:var(--ink)}
.tabs li a small{margin-left:6px;font-size:var(--t12);color:var(--faint)}
.tabs form{display:flex;gap:6px;flex:none}
.tabs select,.tabs button{height:28px;border:1px solid var(--line);border-radius:var(--r6);background:var(--surface);color:var(--muted);font:var(--t13) var(--sans);padding:0 var(--s2)}
.search{position:relative;flex:0 1 320px}
.search input{width:100%;height:32px;padding:0 var(--s3) 0 32px;border:1px solid var(--line);border-radius:var(--r6);background:var(--surface);color:var(--ink);font:var(--t13) var(--sans)}
.search input:focus{outline:2px solid var(--accent);outline-offset:1px}
.search svg{position:absolute;left:10px;top:8px;width:16px;height:16px;color:var(--faint)}
.tape{display:flex;align-items:center;gap:var(--s3);margin:0 0 var(--s6);font-size:var(--t13);color:var(--muted)}
.tape>span{flex:none;color:var(--ink);font-weight:600}
.tape ul{display:flex;gap:var(--s5);min-width:0;margin:0;padding:0;list-style:none;overflow-x:auto;scrollbar-width:none;white-space:nowrap}
.tape ul::-webkit-scrollbar{display:none}
.tape time{color:var(--faint);margin-right:6px}.tape a:hover{color:var(--ink)}
.fresh{animation:flash 2.4s ease-out}
@keyframes flash{0%,30%{background:var(--accent-soft)}100%{background:transparent}}
@media (prefers-reduced-motion:reduce){.fresh{animation:none}}
.list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.list>li{border-bottom:1px solid var(--line)}
.line{display:grid;grid-template-columns:72px minmax(0,1fr) auto;align-items:center;gap:var(--s4);min-height:var(--row);padding:var(--s2) var(--s2);margin:0 calc(-1 * var(--s2));border-radius:var(--r6);font-size:var(--t13)}
a.line:hover,a.line:focus-visible{background:var(--surface)}
.line .amt{font-weight:600;font-variant-numeric:tabular-nums;color:var(--accent)}
.line .q{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;color:var(--ink)}
.line .side{display:flex;gap:var(--s4);color:var(--faint);white-space:nowrap;font-size:var(--t12)}
.line .side .mk{color:var(--muted)}
@media (max-width:640px){.line{grid-template-columns:56px minmax(0,1fr);row-gap:2px;align-items:start}.line .q{-webkit-line-clamp:unset}.line .side{grid-column:2;gap:var(--s1) var(--s3);flex-wrap:wrap}}
.empty{padding:var(--s3) 0;color:var(--muted);font-size:var(--t13);margin:0}
section.tab{margin-bottom:var(--s8)}
section.tab>h2{font:600 var(--t12) var(--sans);color:var(--faint);margin:0 0 var(--s2)}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 var(--s6);margin:0;padding:0;list-style:none}
@media (max-width:980px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media (max-width:640px){.grid{grid-template-columns:1fr}.search{flex-basis:100%}.tabs{flex-wrap:wrap;gap:0}.tabs form{order:-1;width:100%;margin-bottom:6px}.tabs select{flex:1}.tabs ul{width:100%}}
.card{display:flex;flex-direction:column;border-top:1px solid var(--line);padding:var(--s3) 0 var(--s4)}
.card h3{display:flex;align-items:center;gap:var(--s2);font:600 var(--t13)/1.4 var(--sans);margin:0 0 var(--s2)}
.card h3 a:hover{color:var(--accent)}
.glyph{display:none}
.rows{list-style:none;margin:0;padding:0;flex:1}
.row a{display:grid;grid-template-columns:1fr auto;gap:var(--s3);align-items:center;padding:6px var(--s2);margin:0 calc(-1 * var(--s2));border-radius:var(--r6)}
.row a:hover,.row a:focus-visible{background:var(--surface);outline:none}
.q{font-size:var(--t13);line-height:1.4}
.row .q{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.who{display:block;margin-top:2px;font-size:var(--t12);color:var(--faint)}
.pill{font:600 var(--t13) var(--sans);font-variant-numeric:tabular-nums;color:var(--accent)}
.foot-row{display:flex;justify-content:space-between;gap:var(--s3);margin-top:var(--s2);font-size:var(--t12);color:var(--faint)}
.foot-row a{color:var(--muted)}.foot-row a:hover{color:var(--ink)}
.stores{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
.stores li a{display:grid;grid-template-columns:1fr auto auto;gap:var(--s4);align-items:center;min-height:var(--row);padding:var(--s2) 0;border-bottom:1px solid var(--line);font-size:var(--t13)}
.stores b{font-weight:600}.stores span{color:var(--muted)}.stores em{font-style:normal;color:var(--muted)}
.stores li a:hover b{color:var(--accent)}
@media (max-width:640px){.stores li a{grid-template-columns:1fr auto}.stores span{grid-column:1/-1;order:3}}
.offers{list-style:none;margin:var(--s6) 0 0;padding:0;border-top:1px solid var(--line)}
.offer{display:grid;grid-template-columns:1fr auto;gap:var(--s5);padding:var(--s5) 0;border-bottom:1px solid var(--line)}
.offer h2{font:600 var(--t15)/1.4 var(--sans);margin:0 0 var(--s2)}.offer h2 a:hover{color:var(--accent)}
.offer blockquote{margin:0 0 var(--s2);padding-left:var(--s3);border-left:2px solid var(--line);color:var(--muted)}
.offer .fit{margin:0 0 var(--s2);font-size:var(--t13);color:var(--muted)}
.offer .by{margin:0;font-size:var(--t12);color:var(--faint)}.offer .by a{color:var(--muted)}.offer .by a:hover{color:var(--accent)}
.buy{align-self:center}
@media (max-width:640px){.offer{grid-template-columns:1fr}.buy .go{width:100%}}
.related{display:flex;flex-wrap:wrap;gap:var(--s2) var(--s4);margin:0;padding:0;list-style:none;font-size:var(--t13);color:var(--muted)}
.related a:hover{color:var(--ink)}
.bid-form{display:flex;flex-direction:column;gap:var(--s4);max-width:640px;margin-top:var(--s4);padding:var(--s5);background:var(--raise);border:1px solid var(--line);border-radius:var(--r12);box-shadow:var(--shadow)}
.bid-form label{display:flex;flex-direction:column;gap:6px;font-size:var(--t13);font-weight:600;color:var(--muted)}
.bid-form textarea,.bid-form input,.bid-form select{width:100%;padding:var(--s2) var(--s3);border:1px solid var(--line);border-radius:var(--r4);background:var(--bg);color:var(--ink);font:var(--t15)/1.4 var(--sans)}
.bid-form textarea{resize:vertical}
.bid-form :focus{outline:2px solid var(--accent);outline-offset:1px}
.pair{display:grid;grid-template-columns:140px 1fr;gap:var(--s3)}
@media (max-width:640px){.pair{grid-template-columns:1fr}}
.dollar{position:relative}.dollar:before{content:"$";position:absolute;left:var(--s3);top:50%;transform:translateY(-50%);color:var(--muted)}
.dollar input{padding-left:26px}
.bid-form .go{align-self:flex-start}
.error{margin:0;padding:var(--s2) var(--s3);border-radius:var(--r6);background:color-mix(in srgb,#d0453b 14%,var(--raise));font-size:var(--t13)}
.sheet{flex:0 0 auto}.sheet[open]{flex-basis:100%}
.sheet summary{list-style:none}.sheet summary::-webkit-details-marker{display:none}
.timeline{list-style:none;margin:0;padding:0;font-size:var(--t13);color:var(--muted)}
.timeline li{display:flex;gap:var(--s3);padding:6px 0}
.timeline time{min-width:52px;color:var(--faint)}
.timeline a{color:var(--accent)}
.actions{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s2) var(--s3);margin:var(--s5) 0 0}
.actions+.note{margin-top:var(--s3)}
.props{display:flex;flex-wrap:wrap;gap:var(--s1) var(--s5);margin:var(--s2) 0 0;padding:0;list-style:none;font-size:var(--t13);color:var(--muted)}
.props b{color:var(--ink);font-weight:600}
.foot{display:flex;flex-wrap:wrap;justify-content:space-between;gap:var(--s3);margin-top:var(--s16);padding-top:var(--s5);border-top:1px solid var(--line);font-size:var(--t12);color:var(--faint)}
.foot nav{display:flex;gap:var(--s4)}.foot a:hover{color:var(--ink)}
`;

// Instant search over the cards already drawn; without it the form searches on the server.
// The counts and every [data-live] list show as they are, then follow the page's [data-poll] (the marketplace's /marketplace/stats.json by default):
// a count rolls and a list redraws only when its key moves, and items whose data-k is new slide in.
export const SCRIPT = `const col="<span class=\\"digit\\" aria-hidden=\\"true\\"><span>"+"0123456789".split("").map(d=>"<i>"+d+"</i>").join("")+"</span></span>";const roll=(b,v)=>{const t=String(v);b.setAttribute("aria-label",t);if(b.dataset.v===t)return;const was=b.dataset.v;b.dataset.v=t;if(!was)return;const from=was.padStart(t.length,"0").slice(-t.length);b.innerHTML=col.repeat(t.length);const cols=[...b.querySelectorAll(".digit>span")];cols.forEach((c,i)=>{c.style.transition="none";c.style.transform="translateY(-"+from[i]+"0%)"});b.offsetHeight;cols.forEach((c,i)=>{c.style.transition="";c.style.transform="translateY(-"+t[i]+"0%)"});b.classList.add("tick");setTimeout(()=>b.classList.remove("tick"),1600)};const stats=[...document.querySelectorAll("[data-stat]")];stats.forEach(b=>roll(b,b.textContent));const live=[...document.querySelectorAll("[data-live]")];const news=n=>live.forEach(l=>{const k=n[l.dataset.live+"_key"];if(typeof k!=="string"||k===l.dataset.key)return;const had=new Set(l.dataset.key.split("|"));l.dataset.key=k;l.innerHTML=n[l.dataset.live];l.querySelectorAll("[data-k]").forEach(i=>had.has(i.dataset.k)||i.classList.add("fresh"))});const poll=document.querySelector("[data-poll]")?.dataset.poll||"/marketplace/stats.json";(stats.length||live.length)&&setInterval(()=>{document.hidden||fetch(poll).then(r=>r.ok?r.json():null).then(n=>{if(!n)return;stats.forEach(b=>typeof n[b.dataset.stat]==="number"&&roll(b,n[b.dataset.stat]));news(n)}).catch(()=>{})},30000);const f=document.querySelector(".search input[name=q]"),c=[...document.querySelectorAll(".card")],t=[...document.querySelectorAll("section.tab")],e=document.querySelector(".none");f&&f.addEventListener("input",()=>{const q=f.value.trim().toLowerCase();let n=0;for(const k of c){const m=!q||k.dataset.search.includes(q);k.hidden=!m;n+=m}for(const s of t)s.hidden=!s.querySelector(".card:not([hidden])");e&&(e.hidden=n>0)});const s=document.querySelector(".tabs select");s&&s.addEventListener("change",()=>s.form.submit());document.querySelectorAll(".tabs button").forEach(b=>b.remove());document.querySelectorAll("[data-share]").forEach(a=>a.addEventListener("click",e=>{e.preventDefault();const u=a.href;(navigator.share?navigator.share({url:u}):navigator.clipboard.writeText(u).then(()=>{const t=a.textContent;a.textContent="Link copied";setTimeout(()=>a.textContent=t,1600)})).catch(()=>{})}))`;

/** One page in the site's frame: the bar (Bids · Markets · Open source · Download), the body, and one "For agents" link. `section` lights its place in the bar. */
export function page({ title, description, canonical, body, data, section = "", alternate = LIST_URL, head = "" }) {
  const tab = (href, name, label) => `<a${section === name ? ' class="on" aria-current="page"' : ""} href="${href}">${label}</a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title><meta name="description" content="${escape(description)}"><link rel="icon" href="/favicon.svg">
<link rel="canonical" href="${escape(canonical)}"><link rel="alternate" type="application/json" href="${escape(alternate)}"><style>${STYLE}${head}</style>
${data ? `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>` : ""}</head>
<body><main><header class="bar"><a class="brand" href="/">${MARK}Lore</a><nav>${tab("/bids", "bids", "Bids")}${tab("/marketplace", "markets", "Markets")}<a href="${REPO}">Open source</a>${tab("/download", "download", "Download")}</nav></header>
${body}
<footer class="foot"><span>Lore · free and open source, for Mac</span><nav><a href="/llms.txt">For agents</a></nav></footer>
</main><script>${SCRIPT}</script></body></html>`;
}
