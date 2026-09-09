# Privacy

Lore stores private memories locally and exposes only publications the owner
explicitly approves.

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
