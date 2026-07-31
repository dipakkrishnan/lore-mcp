# Spike: can a Lambda runtime host Lore's publication bundle?

Run 2026-07-30. Resolves the open question `docs/node-deployment.md` flags under
"Known asymmetry": *"confirm FTS5 is actually compiled into the Lambda runtime's
`sqlite3` rather than assuming it."*

**Answer: yes on `python3.12` and `python3.13`; no on `python3.10` and
`python3.11`.** The AWS path can reuse Lore's FTS5/BM25 search unchanged, but only
if the provider pins the runtime.

## Method

Two stdlib-only probes against `public.ecr.aws/lambda/python:{3.10,3.11,3.12,3.13}`
on both `linux/arm64` and `linux/amd64`:

- `fts5_probe.py` builds the proposed bundle schema — the publication subset plus a
  `publications_fts` external-content index with Lore's exact
  `tokenize='unicode61 remove_diacritics 2'` — and runs the real
  `search_publications` query, rather than trusting `PRAGMA compile_options`.
- `read_probe.py` reads a bundle *built locally* (SQLite 3.51) inside each runtime,
  which is the actual production shape: the owner's machine exports, the Lambda
  only reads.

Checks: FTS5 present, schema creatable, BM25 genuinely ranking (high term
frequency in a short document must outrank one mention in a long one), the
`remove_diacritics 2` option honored (`cafe` must match `café`), multi-term AND,
and querying with the database opened **read-only**, as the handler will.

## Results

| Runtime | Base OS | SQLite | FTS5 | Verdict |
|---|---|---|---|---|
| `python3.13` | AL2023 | 3.40.0 | yes | all checks pass, both arches |
| `python3.12` | AL2023 | 3.40.0 | yes | all checks pass, both arches |
| `python3.11` | AL2 | 3.7.17 | **no** | `no such module: fts5` |
| `python3.10` | AL2 | 3.7.17 | **no** | `no such module: fts5` |

On 3.12/3.13 every check passed, including BM25 ordering, diacritic folding, and
read-only queries. Local macOS baseline (SQLite 3.51.0) agrees, so search results
are consistent between `lore serve` and a deployed node.

## The failure mode is total, not silent

This was the thing worth confirming, since a silent wrong answer on the disclosure
path would be much worse than an error. Handing the locally-built bundle to
`python3.11` fails *every* query, including plain `SELECT count(*)` and a `LIKE`
fallback:

```
DatabaseError: malformed database schema (publications_fts_config)
               - near "WITHOUT": syntax error
```

SQLite 3.7.17 predates `WITHOUT ROWID` (3.8.2), which FTS5's shadow tables use, so
the schema is unparseable and the whole file is unreadable. A misconfigured runtime
therefore cannot return partial, stale, or unranked results — it returns nothing at
all, loudly. Good news for the security boundary; it also means no degraded-search
code path needs to exist.

## Consequences for the implementation

Applied in this change:

1. **Lore now requires Python 3.12+.** `requires-python`, `uv.lock`, `install.sh`,
   and the README moved from `>=3.10` together. The floor is set by SQLite, not by
   any language feature — the comment in `pyproject.toml` says so, because
   otherwise the next person to read it will reasonably try to lower it.
   `install.sh` also now checks FTS5 directly, since a Python whose SQLite lacks
   the module would install fine and fail on the first search.
2. **Keeping the local floor and the deployment floor identical is the point.**
   `>=3.10` made `python3.10` an entirely reasonable guess for whoever wires up the
   function, and the result would be a node that deploys and then cannot answer.

Still to apply, when the provider lands:

3. **Pin the Lambda runtime to `python3.13`.** The AWS provider should refuse to
   provision anything older with a message naming FTS5 as the reason, and the
   runtime string belongs in the `aws` argv assertions so a later edit cannot
   silently downgrade it.
4. **The exporter must build the bundle with `PRAGMA journal_mode=DELETE`.** A
   WAL-mode bundle copied without its `-wal` sidecar — exactly what uploading the
   one file does — may or may not open read-only, *depending on the SQLite build
   doing the reading*:

   | SQLite | WAL bundle, copied alone, opened read-only |
   |---|---|
   | 3.40.0 (Lambda python3.12/3.13) | works |
   | 3.51.0 (pyenv CPython 3.14.6) | **fails:** `unable to open database file` |
   | 3.53.1 (uv-managed CPython 3.14.6) | works |

   Two interpreters of the *same* Python version on the same machine disagree,
   because they link different SQLite builds. That is the worst shape a bug can
   have: it would go green in CI and fail for a developer, or vice versa, with
   nothing in the diff to explain it. A bundle written with `journal_mode=DELETE`
   records file-format versions `1/1` in its header and is readable by any build,
   so the exporter pins the mode and a test asserts the header rather than
   asserting a behavior that varies.

   Worth stating plainly because it is easy to misdiagnose: this is not a
   macOS-vs-Linux split. Both failing and passing builds were observed on the same
   machine, under two interpreters reporting the same Python version.
5. **Populate the FTS index with a one-time `'rebuild'` at export**, not triggers.
   Triggers only pay off for a mutable database; the bundle is written once.
6. **Add a cold-start FTS5 assertion in the handler** anyway, so the diagnostic
   names the cause rather than surfacing `malformed database schema`.
7. **Bundle size**: 24,576 bytes for 3 publications, dominated by page overhead
   and the FTS index. Not a constraint at any realistic publication count.

## Caveat

These are the AWS-published Lambda **base images**, which mirror the managed
runtimes but are not literally the same artifact. The live test tier should assert
the deployed function's `sqlite3.sqlite_version` and FTS5 availability once an AWS
account is wired up, turning this one-time finding into a standing check.

## Reproducing this

```sh
tests/spikes/run.sh              # all four runtimes, both architectures
tests/spikes/run.sh 3.13         # just one
```

Needs Docker; needs no AWS account. It exits non-zero only if a runtime Lore
claims to support fails — failures below the 3.12 floor are the expected result and
are labelled as such. `fts5_probe.py` builds and queries a bundle inside the
runtime; `read_probe.py` reads a bundle built by the local (modern) SQLite, which
is the real production shape. Both are stdlib-only.

Kept in the tree rather than thrown away because the next runtime deprecation will
force a version bump, and this is the check that says whether the new floor is
safe.
