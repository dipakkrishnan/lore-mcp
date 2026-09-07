# Privacy

Lore stores private memories locally and exposes only publications the owner
explicitly approves.

## Desktop telemetry

The desktop app sends a small set of milestone events (app opened, setup
completed, a memory saved, a publication approved, the store opened, a sale
viewed) to a service the maintainers operate, so they can see whether people
reach a first sale. This is **on by default** and disclosed at first launch
and in Settings.

Every event carries only a random installation id (generated on your machine,
resettable, and derived from nothing about it), the app version, a timestamp,
and coded outcomes from a fixed vocabulary. It never carries memory or
publication content, a prompt, a file path, a URL, a wallet address, a
transaction hash, or a credential. Delivery is best-effort and never blocks
anything you do.

Turn it off any time in Settings, or with `lore telemetry off`. See
`docs/telemetry.md` for the full event list and the vocabulary that enforces
this.

## A deployed node's own observability

If you deploy a paid Lore node, its Cloudflare Worker can record its own
request traces and logs — request rate, error rate, and coded outcomes like
"publication not found" or "payment settled." This stays entirely in **your
own Cloudflare account**; the maintainers never see it. It never carries a
buyer's question, a wallet address, a transaction hash, or publication
content — see `docs/telemetry.md` for the attribute allowlist.

The maintainers' own standing QA deployment is separate infrastructure,
seeded only with synthetic fixture data, used to verify each release actually
serves before it reaches an owner's node.

## Third-party providers

If you deploy a paid Lore node, the selected hosting and payment providers
process requests under their own privacy policies. See the repository
documentation for the deployment boundary and configuration details.
