// yourlore.dev/download: starts the download and says what to do next, the way the browser in hand shows it (XC-125).
// The picture is drawn, not a screenshot: a toolbar with the downloads button lit and the file under it.
import { DOWNLOAD, escape, page } from "./layout.js";

const FILE = "Lore-macOS-arm64.dmg";
const BID = /^[A-Za-z0-9_-]{1,64}$/;

/** Which browser drew the request, by the convention each one's user agent follows. @returns {"chrome" | "edge" | "safari" | "firefox" | "other"} */
export function browserOf(ua = "") {
  if (/Firefox\//.test(ua)) return "firefox";
  if (/Edg\//.test(ua)) return "edge";
  if (/(Chrome|Chromium|CriOS)\//.test(ua)) return "chrome";
  if (/Version\/[\d.]+.*Safari\//.test(ua)) return "safari";
  return "other";
}

/** Only a Mac starts the download on its own; a phone or a PC is told where Lore runs. An iPad asks for the desktop
 * site with a Mac's user agent, so the page itself checks for touch and comes back with `touch=1` before the download starts. */
const onMac = (ua = "") => /Macintosh|Mac OS X/.test(ua) && !/iPhone|iPad|Android/.test(ua);

/** Runs before the refresh can fire: a touch screen behind a Mac user agent is an iPad, so it reloads as one. */
const TOUCH = `<script>if(navigator.maxTouchPoints>1){const u=new URL(location.href);u.searchParams.set("touch","1");location.replace(u)}</script>`;

const FIRST = {
  chrome: "Open the download from the arrow at the top right of Chrome",
  edge: "Open the download from the arrow at the top right of Edge",
  safari: "Open the download from the arrow in Safari's toolbar",
  firefox: "Open the download from the arrow in Firefox's toolbar",
  other: "Open the download from your browser, or your Downloads folder"
};

const ARROW = '<path d="M0 0v7M-3.2 3.8L0 7l3.2-3.2M-4.5 9.5h9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>';
const SAFARI_ARROW = '<circle r="6.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M0-3v5.5M-2.6 0L0 2.6 2.6 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>';
const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="5" class="lamp"/>`;
const lamps = (y) => dot(22, y) + dot(38, y) + dot(54, y);
const glyph = (x, y, d) => `<g transform="translate(${x} ${y})" class="ico">${d}</g>`;
const nav = (x, y) => glyph(x, y, '<path d="M3-4.5L-1.5 0 3 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>') + glyph(x + 22, y, '<path d="M-3-4.5L1.5 0-3 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>');
const field = (x, y, w) => `<rect x="${x}" y="${y - 12}" width="${w}" height="24" rx="12" class="field"/><text x="${x + 14}" y="${y + 4}" class="url">yourlore.dev/download</text>`;
/** The lit downloads button: a ring in the accent, and the arrow inside it. */
const lit = (x, y, icon) => `<circle cx="${x}" cy="${y}" r="15" class="lit"/><g transform="translate(${x} ${y - (icon === SAFARI_ARROW ? 0 : 4.5)})" class="on">${icon}</g>`;

/** Each browser's toolbar, reduced to what places its downloads button; returns the drawing and where the button sits. */
const TOOLBARS = {
  chrome: () => ({
    x: 392,
    y: 70,
    art: `${lamps(20)}<path d="M84 34V18a6 6 0 0 1 6-6h120a6 6 0 0 1 6 6v16" class="tab"/><text x="98" y="27" class="tabname">Download Lore</text>
<rect x="0" y="34" width="460" height="1" class="hair"/>${nav(24, 70)}${field(78, 70, 280)}${glyph(430, 70, '<circle r="7" fill="none" stroke="currentColor" stroke-width="1.4"/>')}`
  }),
  safari: () => ({
    x: 358,
    y: 30,
    art: `${lamps(30)}${nav(86, 30)}${field(130, 30, 200)}${glyph(398, 30, '<path d="M0-6v8M-3-3l3-3 3 3M-5 1v5h10V1" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>')}${glyph(432, 30, '<path d="M0-6v12M-6 0h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>')}`
  }),
  firefox: () => ({
    x: 400,
    y: 70,
    art: `${lamps(20)}<path d="M84 34V14a4 4 0 0 1 4-4h124a4 4 0 0 1 4 4v20" class="tab"/><text x="98" y="27" class="tabname">Download Lore</text>
<rect x="0" y="34" width="460" height="1" class="hair"/>${nav(24, 70)}${field(78, 70, 290)}${glyph(434, 70, '<path d="M-6-4h12M-6 0h12M-6 4h12" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>')}`
  })
};
TOOLBARS.edge = TOOLBARS.chrome;
TOOLBARS.other = TOOLBARS.firefox;

/** The toolbar with its downloads button lit, an arrow at it, and the file underneath, filling in. */
export function toolbar(browser) {
  const { x, y, art } = TOOLBARS[browser]();
  const icon = browser === "safari" ? SAFARI_ARROW : ARROW;
  // The file hangs under the button like the browser's own popover; the arrow comes up from its right.
  const left = x - 216;
  const top = y + 30;
  return `<svg class="art" viewBox="0 0 460 200" role="img" aria-label="The browser's downloads button, at the top right, and ${FILE} coming in under it">
<rect x=".5" y=".5" width="459" height="199" rx="12" class="frame"/>${art}<rect x="0" y="${y + 21}" width="460" height="1" class="hair"/>
${lit(x, y, icon)}
<path d="M${x + 40} ${y + 110}C${x + 44} ${y + 70} ${x + 30} ${y + 40} ${x + 11} ${y + 19}M${x + 11} ${y + 19}l9 2M${x + 11} ${y + 19}l-1 9" class="pointer"/>
<g transform="translate(${left} ${top})"><path d="M${216 - 22} 0l8-8 8 8" class="caret"/><rect width="216" height="62" rx="8" class="bubble"/>
<rect x="14" y="14" width="22" height="26" rx="4" class="disk"/><path d="M19 33h12" class="slot"/><text x="48" y="28" class="file">${FILE}</text>
<rect x="48" y="38" width="150" height="4" rx="2" class="track"/><rect x="48" y="38" width="150" height="4" rx="2" class="fill"/></g></svg>`;
}

const STYLE = `
.get{display:grid;gap:var(--s8);align-items:center;padding:var(--s12) 0 var(--s6)}
@media (min-width:860px){.get{grid-template-columns:minmax(0,1fr) minmax(0,460px)}}
.get h1{font:500 var(--t-display)/1.08 var(--display);letter-spacing:-.02em;margin:0 0 var(--s6);text-wrap:balance}
.steps{margin:0;padding:0;list-style:none;counter-reset:step;display:grid;gap:var(--s4)}
.steps li{counter-increment:step;display:grid;grid-template-columns:24px minmax(0,1fr);gap:var(--s3);font-size:var(--t15);line-height:1.45}
.steps li:before{content:counter(step);display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border:1px solid var(--line);border-radius:var(--pill);font:600 var(--t12)/1 var(--sans);color:var(--muted)}
.steps b{font-weight:600}
.then{margin:var(--s4) 0 0 calc(24px + var(--s3));font-size:var(--t15)}.then a{color:var(--accent)}.then a:hover{text-decoration:underline}
.again{margin:var(--s6) 0 0;font-size:var(--t13);color:var(--muted)}.again a{color:var(--accent)}.again a:hover{text-decoration:underline}
.fine{margin:var(--s2) 0 0;font-size:var(--t12);color:var(--muted)}
.get .lede{margin:0 0 var(--s5);max-width:30em}.send~.then{margin-left:0}.send{display:flex;flex-wrap:wrap;align-items:center;gap:var(--s3)}
.art{display:block;width:100%;height:auto;color:var(--muted);font-family:var(--sans)}
.art .frame{fill:var(--surface);stroke:var(--line)}.art .hair{fill:var(--line)}.art .lamp{fill:var(--line)}
.art .tab{fill:var(--bg);stroke:var(--line)}.art .tabname{font-size:11px;fill:var(--muted)}
.art .field{fill:var(--bg);stroke:var(--line)}.art .url{font-size:11px;fill:var(--muted)}
.art .lit{fill:var(--accent-soft);stroke:var(--accent);stroke-width:1.5}.art .on{color:var(--accent)}
.art .pointer{fill:none;stroke:var(--accent);stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}
.art .bubble{fill:var(--raise);stroke:var(--line);filter:drop-shadow(0 2px 6px rgba(0,0,0,.14))}.art .caret{fill:var(--raise);stroke:var(--line)}
.art .disk{fill:var(--accent-soft);stroke:var(--accent)}.art .slot{stroke:var(--accent);stroke-width:1.5;stroke-linecap:round}.art .file{font-size:12px;font-weight:600;fill:var(--ink)}
.art .track{fill:var(--line)}.art .fill{fill:var(--accent);transform-box:fill-box;transform-origin:left;animation:fill 6s cubic-bezier(.2,.7,.2,1) forwards}
@keyframes fill{from{transform:scaleX(.04)}to{transform:scaleX(1)}}
@media (prefers-reduced-motion:reduce){.art .fill{animation:none}}
`;

/**
 * The page /download serves: on a Mac the download starts by itself (a refresh to the file, which the browser saves
 * and stays put), and three steps say what comes next. `bid` is the bid someone came to answer, if any.
 * @param {{ ua?: string, bid?: string | null, touch?: boolean }} [request]
 */
export function downloadPage({ ua = "", bid = null, touch = false } = {}) {
  const mac = onMac(ua) && !touch;
  const browser = browserOf(ua);
  const back = bid && BID.test(bid) ? `/b/${bid}` : null;
  const steps = [
    escape(FIRST[browser]),
    `Double-click <b>${FILE}</b>`,
    "In the window that opens, drag Lore into Applications, then open it from there"
  ];
  const then = back ? `<p class="then">Once Lore is open, the bid you came from is under <b>Bids</b>. <a href="${escape(back)}">See the bid</a></p>` : "";
  const fine = `<p class="fine">For Macs with Apple silicon · Notarized by Apple</p>`;
  // Off a Mac the steps can't be followed here: hand the page to the Mac (the share sheet offers AirDrop), or take the file.
  const body = mac
    ? `<section class="get"><div>
<h1>Open Lore in 3 steps</h1>
<ol class="steps">${steps.map((step) => `<li><span>${step}</span></li>`).join("")}</ol>
${then}
<p class="again">Download didn't start? <a href="${DOWNLOAD}" download>Download again</a></p>
${fine}
</div>${toolbar(browser)}</section>`
    : `<section class="get"><div>
<h1>Lore is for your Mac</h1>
<p class="lede">Open this page on a Mac with Apple silicon and the download starts by itself.</p>
<div class="send"><a class="go" data-share href="https://yourlore.dev/download${back ? `?bid=${escape(bid)}` : ""}">Send this page to your Mac</a><a class="quiet" href="${DOWNLOAD}" download>Download for Mac</a></div>
${then}
${fine}
</div></section>`;
  return page({
    title: "Download Lore",
    description: "Download Lore for Mac, then open it in three steps.",
    canonical: "https://yourlore.dev/download",
    section: "download",
    head: STYLE,
    tags: mac ? `${TOUCH}<meta http-equiv="refresh" content="1;url=${DOWNLOAD}">` : "",
    body
  });
}
