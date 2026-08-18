import json

from lore.store import Store

with Store() as store:
    settings = store.answer_settings()
    publications = [
        {
            "public_id": publication.public_id,
            "title": publication.title,
            "content": publication.content,
            "kind": publication.kind.value,
            "topic": publication.topic,
            "teaser": publication.teaser,
            "updated_at": publication.updated_at,
        }
        for publication in store.list_publications(active_only=True)
        if publication.teaser
    ]

if not settings.proxy_preamble.strip():
    raise SystemExit(
        "Configure a proxy charter with `lore answer on <proxy-file> <price>` first."
    )
if not publications:
    raise SystemExit(
        "Approve at least one publication with a teaser before evaluating the proxy."
    )

print(
    json.dumps(
        {
            "proxy": settings.proxy_preamble,
            "price": settings.answer_price_usd or 0.01,
            "publications": publications,
        }
    )
)
