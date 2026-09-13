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

## Desktop telemetry

The desktop app does not currently send activation events to the maintainers.
A proposed milestone funnel and its disclosure and opt-out controls are tracked
in `docs/telemetry.md`; they are not implemented or enabled in this release.

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
