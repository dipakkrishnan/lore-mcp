# Hosted nodes

Spike for issue #369 (DOC-003). Prices are Cloudflare's published rates as
of 2026-10-04.

## The problem

Opening a store today takes a Mac, a Cloudflare account (sign-up, email
verification, a one-time workers.dev subdomain), an `npm install` plus
`wrangler deploy` run from the app, a D1 database, and a payout address.
The seeding plan is 10–20 sellers in one niche who are not developers. The
first trial user stalled at one unfamiliar account (the wallet, MON-025);
Cloudflare is a second one, and the deploy pipeline has needed five fixes
(MON-011, 012, 019, 022, 023) to stop failing on strangers' machines.

## Options

Traffic assumption per seller per month, generous for seeding: 5k Worker
requests (store pages are edge-cached, MON-029), 1k MCP calls (each is one
Durable Object request, ~5 s active at 128 MB = 0.6 GB-s), ~1 MB of
publications. Lore's variable cost is dominated by Durable Object duration;
hibernated objects cost nothing.

| Option | Seller steps removed | Lore cost: 20 sellers | Lore cost: 1000 sellers | Lore holds money? | Effort |
|---|---|---|---|---|---|
| **A. Today**: Worker + D1 in the seller's Cloudflare account | none | $0 | $0 | No | 0 |
| **B. One shared Worker + one D1 (tenant column) on Lore's account** | Cloudflare account, login, subdomain, npm install, D1 create, deploy wait. Left: install app, pick price, paste payout address | **$5/mo flat** (Workers Paid; the Free plan would also hold 20 sellers at $0) ≈ $0.25/seller | **~$8–15/mo** ≈ $0.01/seller (5M req and 1M DO req inside the $5 plan; ~225k GB-s over at $12.50/M ≈ $3; D1 well inside 25B reads/5 GB). At 10× that traffic ≈ $90/mo ≈ $0.09/seller | No (see below) | ~1.5 weeks |
| **C. Workers for Platforms**: one script per seller in a dispatch namespace on Lore's account | same as B | **$25/mo** ≈ $1.25/seller | **$25/mo + B's variable costs** ≈ $0.03/seller; 1000 scripts included, $0.02 each after | No | ~2.5 weeks (dispatch Worker, per-seller bindings) |
| **D. One-click self-deploy** (Deploy-to-Cloudflare button, or the app driving Cloudflare's REST API with the seller's OAuth token, no npm) | npm install, D1 create, deploy wait. Left: Cloudflare account + login (+ a GitHub account for the button, which forks the repo into it) | $0 | $0 | No | ~1 week (REST path) |

Custody is the same in every row: an x402 challenge names the seller's
`LORE_WALLET` as recipient and the facilitator only broadcasts the buyer's
signed transfer (`lore/node/src/network.ts`); Stripe Connect direct charges
(XC-039) settle on the seller's own connected account. In B and C that
address becomes a per-tenant row instead of a per-account secret, so Lore
still never receives funds, but one compromised Worker could redirect every
tenant's payouts, where today an attacker gets one seller's account. B also
makes Lore the party that stores and serves the content, so seller terms and
a takedown path (XC-041) stop being optional.

C buys isolation Lore does not need: every tenant runs the same code, and
Workers for Platforms exists for running customers' own code. D removes the
clicks but not the accounts, and the account is the step people quit at.

## Recommendation

Build B. At the seeding scale it costs $5 a month, the price of one buyer's
lunch, and it removes every infrastructure step from the seller's path. The
seller's Mac stays the source of truth for the library, so moving to a
self-hosted node later is `lore node deploy` to their own account, one push,
and a redirect from the old URL; option A stays as the "run it yourself"
path and the migration target, and option D is a later polish to A, not a
competitor to B.

### Minimal first slice (~1.5 weeks, one person)

1. **Node, tenant-aware.** Routes `/s/<slug>/`, `/s/<slug>/p/<id>`,
   `/s/<slug>/mcp`. A `tenants` table (slug, name, wallet, network,
   price_usd, push_token_hash, created_at); `publications`, `node_settings`
   and `sales` gain a `tenant` column and index. The fetch handler resolves
   the slug and hands it to the Durable Object through `ctx.props`;
   `payTo`, `network` and the price move from env and a compile-time
   constant (`deploy.py` rewrites `price.ts` today) into the tenant row, and
   the `withX402` server is built in `init()` where props are available.
   `discover` output is unchanged, so the marketplace refresh (XC-036) lists
   hosted and self-hosted nodes identically.
2. **Provision and push over HTTP.** `POST /s` creates a tenant and returns
   its URL plus a one-time push token; `PUT /s/<slug>/publications` with
   that token replaces the tenant's publications and settings (today's push
   semantics); `GET /s/<slug>/sales` with the token returns the ledger.
   Rate-limit provisioning per IP and require at least one approved
   publication in the first push, so empty stores cannot be minted in bulk.
3. **CLI and app.** `lore node deploy --hosted` provisions and pushes over
   HTTP instead of wrangler; `lore push` and `lore node sales` go the same
   way when `node_url` is hosted. The token lives beside the other
   credentials (`credentials.bin`, Electron `safeStorage`). "Open your
   store" defaults to hosted; "Run it on your own Cloudflare" remains in
   Settings.
4. **Deploy.** A `hosted` env in `wrangler.jsonc` on Lore's account, routed
   at `nodes.yourlore.dev/*`, deployed by a workflow shaped like
   `deploy-qa.yml`.
5. **Terms.** Hosted stores list only once XC-041's terms and takedown
   contact are live.

## What blocks Windows and Linux in `app/desktop`

- `forge.config.js`: `makers` is only `@electron-forge/maker-zip` for
  `darwin`; signing is `osxSign`/`osxNotarize` only. Needs Squirrel or MSIX
  plus an Authenticode certificate for Windows, deb/rpm/AppImage for Linux.
- `forge.config.js` `ignored`: strips every native payload except
  `darwin-arm64` (`@esbuild/*`, `@mariozechner/clipboard-*`,
  `sandbox-runtime/vendor/srt-win`), so the bundle must be built per target.
- `packaging/node.sh`: `ARCH=darwin-arm64`; the `bin/node` shim is a
  `/bin/sh` script that execs `../../../MacOS/Lore` inside the `.app`
  bundle. Windows needs a `.cmd` shim and a different path to the Electron
  binary.
- `packaging/wheelhouse.sh`: `ARCH=aarch64-apple-darwin` for uv, builds a
  macOS-only wheelhouse and codesigns `.so`/`.dylib` files; one wheelhouse
  per platform is needed.
- `packaging/whisper.sh`: builds whisper.cpp with `GGML_METAL=ON`; Metal is
  macOS-only, so dictation needs a CPU or Vulkan/CUDA build and a cmake/MSVC
  toolchain in CI. `main.cjs` asks for the microphone through
  `systemPreferences.askForMediaAccess`, also macOS-only.
- `src/agent.mjs`: `@anthropic-ai/sandbox-runtime` wraps the agent; its
  Linux backend needs bubblewrap installed, and the Windows payload
  (`srt-win`) is unexercised here. Its home allow-list names
  `Library/LaunchAgents`, `Library/Preferences/.wrangler`,
  `Library/Caches/.wrangler`.
- `lore/automation.py`: synthesis automation is a launchd job
  (`launchctl bootstrap`); needs Task Scheduler and systemd-user timers.
- `lore/paths.py`: the Obsidian default is
  `~/Library/Application Support/obsidian`; ChatGPT and Claude readers probe
  Mac app locations too.
- `lore/signin.py` and `credentials.mjs`: both assume a keychain. Windows
  Credential Manager works through `keyring` and `safeStorage`; headless or
  minimal Linux desktops have no Secret Service and
  `isEncryptionAvailable()` returns false, which `credentials.mjs` treats as
  fatal.
- Release: the desktop CI job runs on `macos-14` only and releases are built
  and notarized by hand on one Mac. Windows and Linux need runners, signing
  secrets, and a download page per platform (APP-040).

A hosted node does not remove any of these: the library, capture and
publishing live in the app. It does remove the one Mac-only step that was
infrastructure rather than product (bundled npm and wrangler), which shrinks
the Windows port.

## Open questions

- Does Lore's Cloudflare account already carry the Workers Paid plan (the QA
  and relay Workers live there)? If so B's marginal cost at 20 sellers is $0.
- Slug policy: seller-chosen (squatting, impersonation) or assigned?
- Lost push token: re-provision under a new slug, or a recovery path tied to
  the payout address signature?
- Per-tenant request limits so one busy or crawled store cannot exhaust the
  shared plan (MON-034 for the single-tenant case).
- Does the agents SDK's `McpAgent.serve` accept per-request `ctx.props` with
  `withX402` wrapping the server at construction time, or must the wrapper
  move into `init()`? One afternoon on a branch answers it.
- Hosted content sits in Lore's D1: say so in XC-031 (what becomes public)
  and in the terms.

## Follow-up issues

- MON: Make the node tenant-aware behind `/s/<slug>` with per-tenant payout, price and network
- MON: Provision and push a hosted store over HTTP with a per-tenant token
- APP: Open a hosted store by default; keep "your own Cloudflare" in Settings
- XC: Deploy the hosted node Worker to Lore's account at nodes.yourlore.dev
- XC: Migrate a hosted store to a self-hosted node with a redirect
- XC: Seller terms and takedown contact before the first hosted listing
- APP: Windows build: Squirrel maker, Authenticode signing, per-platform node and wheelhouse
- APP: Linux build: deb/AppImage maker, bubblewrap and Secret Service checks
- APP: Dictation without Metal: CPU whisper build per platform
