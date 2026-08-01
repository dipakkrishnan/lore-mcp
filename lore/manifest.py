"""The free surface: an owner-approved catalog of what this node offers.

`discover` returns this manifest so a buying agent reads once and chooses, instead
of guessing keywords that happen to match someone else's vocabulary. It is a pure
function of the active publications — no synthesis, no request-time construction,
no LLM in the path — which is what makes the privacy invariant below hold by
construction rather than by vigilance.

Two separate leak budgets are enforced here:

1. **The private library's shape.** Nothing in the rendered text may move in
   response to a private row being added, edited, or discarded. Branch labels,
   counts, ordering, and gaps are all disclosures about private material even when
   no private content is returned — the same class of leak as the provenance
   memory ids removed in STO-001.
2. **The value this node sells.** The manifest is free; `answer` is the product.
   For a `claim`-kind publication the title often *is* the claim ("Live demos
   outperform cold decks") and delivers its full value as a catalog line. So
   claims are advertised at topic granularity only; their titles stay behind the
   paywall. `content`-kind titles are listed, because there the title is a label
   and the content is the payload.
"""

from __future__ import annotations

from .store import Publication, PublicationKind
from .ui import CONTROL_CHARACTERS

EMPTY = "# Lore node\n\nThis node currently offers nothing.\n"


def _clean(text: str) -> str:
    """Strip control characters from owner text bound for another agent's context."""
    return text.translate(CONTROL_CHARACTERS).strip()


def render(publications: list[Publication]) -> str:
    """Render the buyer-visible catalog for a set of active publications.

    Callers must pass active publications only; this function does not filter.
    """
    if not publications:
        return EMPTY

    topics: dict[str, list[Publication]] = {}
    for publication in publications:
        topics.setdefault(_clean(publication.topic), []).append(publication)

    # Deterministic ordering, never insertion order: the sequence a buyer observes
    # is itself part of the byte-identical invariant. Casefold first so ordering
    # does not depend on the owner's capitalization, then fall back to the raw
    # label so two topics differing only in case still order stably.
    lines = ["# Lore node", ""]
    lines.append(
        f"{len(topics)} topic{'' if len(topics) == 1 else 's'} · "
        f"{len(publications)} publication{'' if len(publications) == 1 else 's'}"
    )
    for topic in sorted(topics, key=lambda label: (label.casefold(), label)):
        entries = topics[topic]
        # Freshness comes from `updated_at`, never `source_changed_at`. That field
        # is set by Store._flag_publications_of when a *private memory* behind a
        # publication changes, which makes it the one publication column that moves
        # in response to private activity — emitting it, or anything derived from
        # it, would break the invariant in this module's docstring. `updated_at` is
        # deliberately left untouched by that path, so it is safe to disclose.
        freshness = max(entry.updated_at for entry in entries)[:10]
        claims = sum(1 for entry in entries if entry.kind is PublicationKind.CLAIM)
        lines += ["", f"## {topic}"]
        if claims:
            lines.append(f"{claims} claim{'' if claims == 1 else 's'} · updated {freshness}")
        else:
            lines.append(f"updated {freshness}")
        lines += [
            f'- "{_clean(entry.title)}"'
            for entry in sorted(entries, key=lambda entry: (_clean(entry.title), entry.id))
            if entry.kind is PublicationKind.CONTENT
        ]
    return "\n".join(lines) + "\n"


def topics(publications: list[Publication]) -> list[str]:
    """Return the distinct topics of a publication set, in manifest order.

    Topics are already fully disclosed by the manifest, so returning the subset
    matching a buyer's query discloses nothing the catalog did not.
    """
    labels = {_clean(publication.topic) for publication in publications}
    return sorted(labels, key=lambda label: (label.casefold(), label))
