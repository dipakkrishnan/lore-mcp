---
id: XC-076
title: Keep a wrong-shaped public list inside "could not read"
priority: P3
effort: XS
component: cross-cutting
status: in-review
related: [XC-036, XC-075]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-26
updated: 2026-10-26
---

## Problem

`Marketplace._on_file` in `lore/marketplace.py` reads the public
`marketplace.json`. It turns `OSError`, `ValueError` and `KeyError` into
"could not read the public list of Lore sellers; check your connection".
JSON that parses but has the wrong shape escapes that wrapper:

- a top level that is a list (`[]`): `TypeError: list indices must be
  integers or slices, not str`
- `{"sellers": null}`: `TypeError: 'NoneType' object is not iterable`
- a seller that is not an object (`{"sellers": ["x"]}`): `AttributeError:
  'str' object has no attribute 'get'`

`lore/cli.py`'s `main` turns only `OSError` and `ValueError` into a clean
error, so `lore marketplace status` ends in a Python traceback. The desktop
Settings row calls the same command, so it gets that traceback instead of
the message.

A daily workflow in `dipakkrishnan/lore-marketplace` rewrites the file
(`XC-036`). One bad write there would break the Marketplace row for every
owner until the next good write.

## Proposed approach

Check the shape in `_on_file`: the top level must be an object, `sellers` a
list, and each seller an object. Raise the same `OSError` when it is not, so
the CLI and Settings show their existing "could not read" message. Treating
a bad file as "not on the list" would be worse. It would tell a listed
owner they are not listed and give them the request link (see `XC-075`).

## Acceptance criteria

- [ ] For each of `[]`, `{"sellers": null}` and `{"sellers": ["x"]}`,
      `Marketplace.status()` raises `OSError` with "could not read the public
      list".
- [ ] `lore marketplace status` on such a file exits 1. Its stderr has the
      "could not read the public list" message and no `Traceback`.
- [ ] `{"sellers": {}}` with a key, `{"sellers": "x"}` and a top-level
      scalar (`"x"`) raise the same `OSError`.
- [ ] A file whose sellers are all objects still works as today.
- [ ] `tests/test_marketplace.py` covers each line above.

## Notes

Reproduced on `main` at `99da78f` with a `file://` `LORE_MARKETPLACE_URL`.
All three bodies raised the errors listed above. `lore marketplace status
--json` printed a traceback ending in `TypeError: 'NoneType' object is not
iterable` and exited 1.

Filed apart from `XC-075` because the two have different fixes and tests.
`XC-075` makes `list`/`delist` read the file too, so this guard covers
those commands once it lands.
