# Manual test runs

One file per session of `docs/manual-test-walkthrough.md`. Start by copying the
walkthrough:

```sh
cp docs/manual-test-walkthrough.md \
   docs/manual-test-runs/$(date +%F)-<tester>.md
```

Fill in the copy. Leave the walkthrough itself blank — it is the template, and
it is also the canonical list of testable items that the converter diffs every
run against.

When the session is over:

```sh
python3 support/manual_test_report.py docs/manual-test-runs/<file>.md
```

That prints JSON on success and validation errors on failure. Add `--check` to
validate without printing, which is what an agent should run after every edit it
makes mid-session.

## Naming

`<YYYY-MM-DD>-<tester>.md`, where the date is the day the session ran. A second
session by the same person on the same day gets a `-2` suffix.

## These files are committed, and this repository is public

The record is the artifact a launch gate produces, so it belongs in the history
where it can be reviewed in a pull request, diffed against the last run, and
linked from backlog items. That also means everything in it is published.

- **Tester** is whatever name or handle that person is happy to have public.
- **Platform** is an OS version and chip. Not a hostname, not a serial number,
  not a username.
- **Transaction hashes** are fine when they are Base Sepolia. Think before
  committing a mainnet one; it links a real payout address to this project.
- **Never** paste an API key, a secret, a private key, or the contents of
  `.buyer.env` — not even a partial one, and not even one you have since
  rotated. Scenario 4 is specifically about secret handling, so this is the run
  most likely to tempt you.
- **Screenshots are not committed.** Upload them somewhere and put the link in
  that row's Reference URLs.

The generated JSON is not committed either. It is derived from the markdown and
regenerable at any time, and a JSON diff tells a reviewer nothing the markdown
diff does not.

## What a run is for

A completed run says what the build did for one person on one day. It is not a
pass/fail gate on its own — a single `Fail` might be a broken build or might be
one tester's unfamiliar hardware. What makes the record valuable is the notes:
the tester's own words about where they hesitated, what they expected, and what
they had to guess.

Failures get filed as backlog items or issues rather than fixed during the
session, so the run stays a clean picture of the build as it stood. Put the
item's path or issue URL in the Reference URLs column of the row that found it.
