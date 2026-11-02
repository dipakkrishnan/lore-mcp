# Privacy

Lore stores private memories locally and exposes only publications the owner
explicitly approves.

## Feedback

The one thing Lore sends anywhere unprompted is feedback the owner
explicitly asks to send: `lore report-feedback` and the Desktop app's Report
Feedback dialog. Nothing is sent unless the owner runs that command or
submits that form, and a build with no feedback address configured cannot
send at all — the command refuses and the Desktop app shows no button. When
it is configured, a report goes to a maintainer-operated Cloudflare Worker
(`feedback-relay/`), whose only action is filing the report as a GitHub
issue on `dipakkrishnan/lore-mcp` — **that issue is public**, and so is any
email address given with the report. Each submission also carries: the Lore
version, OS and CPU architecture, Python version, and a random id generated
once on that machine and stored locally, so repeat reports from the same
install can be told apart. That id is not derived from anything else on the
machine and carries no memory content, file paths, or wallet addresses. A
copy of everything sent is kept at `~/.lore/feedback/`.

## Anonymous usage events

Lore sends a few anonymous usage events so the maintainers can see where it
helps and where people get stuck. It is on unless you turn it off, and nothing
is sent until Lore has told you about it: on the welcome screen, in a notice
the first time you open an updated app, or once in the terminal.

- **What is sent:** an event name from a fixed list (for example "app opened",
  "store opened", "first piece approved"), at most one coded value (such as
  which app you connected, or "card" or "agent" for a first sale), the Lore
  version, the time, and the same random install id described above.
- **What is never sent:** your memories, pieces, titles, prompts, file paths,
  URLs, prices, amounts, wallet or payment details, or how many of anything
  you have. Most events are sent only the first time they happen; "app
  opened", and "memory saved" with how it came in (you, an agent, a connected
  app, or Lore's own summaries), at most once a day each; a failed command says
  only which command.
- **Where it goes:** to the maintainers' relay (`relay.yourlore.dev`), which
  drops anything not on the fixed list (`contracts/usage_events.json`) and
  passes the rest to PostHog, an analytics service, with no person profile
  and no IP address.
- **See and stop it:** every event sent is also written to
  `~/.lore/usage.log`. Turn it off in Settings → Anonymous usage, or with
  `lore telemetry off`.

## Requests to yourlore.dev

yourlore.dev counts requests to the addresses agents read (`/llms.txt`,
`/marketplace.jsonl`, `/marketplace.json`, each market's JSON and
`/sitemap.xml`). Each request becomes one event, passed privately from the
site to the same relay, carrying only which address was read and a coarse
kind of client taken from its User-Agent (for example "claudebot", "curl" or
"browser"). It sets no cookie, and every event shares one fixed id, so no
visitor can be told apart from another. No IP address, full User-Agent, path,
query or referrer is sent.

## A deployed node's own observability

If you deploy a paid Lore node, its Cloudflare Worker can record its own
request traces and logs — request rate, error rate, and coded outcomes like
"publication not found" or "payment settled." This stays entirely in **your
own Cloudflare account**; the maintainers never see it. Lore's custom span
attributes exclude buyer questions, wallet addresses,
transaction hashes, and publication content. Cloudflare's automatic request
traces and logs are separate platform records, not covered by that attribute
allowlist. See `docs/telemetry.md` for the scope of these guarantees.

The maintainers' own standing QA deployment is separate infrastructure,
seeded only with synthetic fixture data, used to verify each release actually
serves before it reaches an owner's node.

## Third-party providers

If you deploy a paid Lore node, the selected hosting and payment providers
process requests under their own privacy policies. See the repository
documentation for the deployment boundary and configuration details.
