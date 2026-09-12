#!/usr/bin/env python3
"""Seed LORE_HOME with one publication for the worker-smoke CI job (XC-016).

Run before `lore push --local --worker-dir lore/node` so the job pushes a real
publication through the real `lore/cli.py:_push_sql` path, instead of the job
seeding the local D1 database itself with a hand-copied schema. The topic and
teaser here must match SMOKE_EXPECT_TOPIC/SMOKE_EXPECT_TEASER in
.github/workflows/tests.yml, which scripts/smoke.ts checks discover() returns.
"""

from lore.store import Store

TOPIC = "ci-smoke"
TEASER = "worker-smoke: seeded via a real lore push --local"


def main() -> None:
    with Store() as store:
        store.put(
            source="ci",
            origin="native",
            source_path="worker-smoke seed",
            source_key="worker-smoke-seed",
            fingerprint="worker-smoke-seed",
            title="worker-smoke seed memory",
            content="Source memory for the worker-smoke publication.",
        )
        memory_id = store.search("worker-smoke seed memory")[0].id
        store.add_publication(
            title="CI smoke test publication",
            content="Full content the smoke test never reads or asserts on.",
            topic=TOPIC,
            teaser=TEASER,
            provenance=[memory_id],
        )


if __name__ == "__main__":
    main()
