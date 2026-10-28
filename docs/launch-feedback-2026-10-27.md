# Launch feedback, Oct 27 2026

What the first users said on launch day, what we found when we looked, and the
backlog items filed for it. Names are left out; quotes are trimmed.

## What we heard

| Who | What they said | Verdict |
|---|---|---|
| First-time user, non-technical | "Getting this screen 5 times, even though auth was granted" — the welcome flow's Cloudflare step kept showing "Your store didn't go online. Try again in a minute." | **Real, P0.** Sign-up broke. |
| Developer friend | "So people can buy human preference info?… Why is this a dollar? Why would someone buy this?… Is it 'dipak likes jewelry from etsy', a hidden preferences thing, or a marketplace for context?… I find the website a little confusing." Also: "get people placing offers on the app… possibly in bulk." | **Real.** The site never shows what a piece is or isn't. |
| Prospective Windows user | "Whenever it's PC ready I'll be the first user." Building a "save my convos and synthesize" workflow for a trucking business — "this seems like the proper way to do it, even if I'm not selling." | **Real demand signal**, and proof the private keep-and-synthesize value stands alone. |
| Designer-minded friend | "Looks hella vibe coded"; draggable side edge should work; Cmd-K is a dead end; "what did you learn today" is the wrong question ("what did you work on today"); needs a copy pass and a font + sizing pass ("inconsistent fonts"); background needs dimension (Linear, Monday); automation bullets read as to-dos, wants cards. | **5 of 7 real, 2 partly taste.** |
| Same first-time user | "Latency high." | **Partly real**: startup waits on a 5s check plus nine requests; every search and open spawns Python. |

## Why the store didn't go online

Read from code, wrangler's source and two read-only PostHog queries:

- **The reason is thrown away.** The CLI prints `lore: deploy failed:` and the
  cause on the next line; the app keeps only the first line, logs it to a console
  nobody sees, and telemetry records `cli.failed command=node` with no reason. The
  launch-day install hit this four times in four minutes, each attempt failing in
  seconds — not a timeout.
- **Most likely cause: no workers.dev subdomain.** A Cloudflare account that has
  never used Workers has none. Wrangler asks whether to create one, defaults to
  no, and Lore runs it with stdin closed, so every attempt is refused before upload.
- **Second likely cause: unverified email.** Wrangler rewrites Cloudflare's error to
  "Please verify your account's email address", which Lore's check (`10034` /
  `verify your email`) never matches. Test fixtures use the old wording, so tests pass.
- "Try again in a minute" is wrong for every one of these, and each retry
  reinstalls npm packages.

Cloudflare has no API to create accounts or skip email verification, so no amount
of hardening removes the account step itself. The plan keeps user-owned
infrastructure as the goal without putting it on the sign-up path:

1. **Now (XC-085, XC-086, XC-087):** keep and show the real reason with a coded
   telemetry reason; match the real verify-email text; check the account through
   the Cloudflare API first, create the subdomain, pick the account, poll readiness.
2. **Next (APP-249):** setup runs in the background; the welcome flow never waits.
3. **Then (XC-088):** new owners get a hosted inbox at yourlore.dev in seconds.
   Keys and library stay on the Mac; the inbox only relays sealed saves it can't
   read, and Lore never holds money.
4. **Then (XC-089):** one click moves the store to the owner's own Cloudflare and
   back, with agent links unchanged.

## Metrics: where we stand

- **Site visits:** Cloudflare Web Analytics (cookieless) is already on: 35 visits
  Oct 26, 49 Oct 27. Referrers: LinkedIn 16, t.co 5.
- **Downloads:** not counted on the site; the button links straight to the GitHub
  zip. GitHub counts (157 total, v0.1.19: 23) include in-app auto-updates, so they
  overstate installs.
- **Product:** PostHog shows 2 new installs since Oct 26. New users are invisible
  until they reach Today, because the welcome-screen usage notice was removed in
  APP-199 and nothing is sent before it. `cli.failed` is ~98% noise from the
  60-second sales poll. Content is never sent and the install id is random, but
  "Discard client IP data" is still off.

Fixes: APP-250 (measure first runs), XC-085 (store outcome + reason), CLI-013
(stop the poll noise), XC-090 (fill funnel steps), XC-091 (count download clicks),
XC-092 (IP discard, test-install filter, launch dashboard).

## Filed, in order

**P0, this week**

| ID | Item | Effort |
|---|---|---|
| XC-085 | Say why the store didn't go online, and record it | S |
| XC-086 | Recognize Cloudflare's real "verify your email" refusal | XS |
| XC-087 | Get the owner's Cloudflare account ready before putting the store online | S |
| APP-250 | Open the usage gate at the welcome screen again so first runs are measured | XS |
| XC-093 | Say what a piece is, and isn't, on the home page | S |
| XC-088 | Give every new owner a hosted inbox at yourlore.dev on sign-up | L |

**P1, next**

| ID | Item | Effort |
|---|---|---|
| APP-249 | Put the store online in the background so the welcome flow never waits | M |
| XC-092 | Turn on IP discard, filter test installs, build the launch dashboard | XS |
| CLI-013 | Stop background store polls from flooding `cli.failed` | XS |
| XC-090 | Fill the activation funnel's missing steps | S |
| XC-091 | Count download clicks on yourlore.dev without cookies or ids | S |
| XC-095 | Ask Windows visitors to get notified instead of downloading the Mac zip | S |
| MON-049 | Don't sell a piece without a sample, and clean its public topic name | S |
| APP-255 | Show automations as cards with a visible on/off switch | S |
| APP-258 | Copy pass on Today, the memory sheet, the palette and Automations | S |
| APP-257 | Give every memory sheet one clear next action | S |
| APP-256 | Introduce a six-step type scale and one rule for serif vs sans | M |

**P2, soon**

| ID | Item | Effort |
|---|---|---|
| APP-259 | Cut perceived latency at startup, in Cmd-K and when opening a memory | M |
| APP-260 | Make the sidebar resizable by dragging its edge | S |
| APP-262 | Use a faster model for attended capture and check-in replies (owner's call) | XS |
| CLI-014 | Make the lore CLI import and run on Windows | M |
| MON-048 | Let buyers ask for a piece and offer a price (run by hand first) | M |
| XC-094 | One name and a one-line intro for the marketplace | XS |
| XC-089 | Move my store to my own Cloudflare in one click, and back | M |

**P3, if Windows demand shows up on the XC-095 waitlist**

APP-251 approval launch key, APP-252 agent sandbox, APP-253 signed installer and
auto-update, APP-254 tray and background running. APP-261 (inset panel for depth)
is P3 taste: show a screenshot before building it.

## Windows, briefly

Neither the app nor the CLI starts on Windows today (`pwd`/`fcntl` imports,
`process.getuid()` in the trust check). The security-sensitive parts (approval
handshake, attachment block-list) must be ported, not stubbed. Phases: site
waitlist + CI canary (~1 day) → CLI-only, usable from Claude Desktop (3–5 days) →
desktop beta without selling (3–4 weeks) → parity (+2–4 weeks). WSL is not a
product path.
