"""Build the synthetic ChatGPT and Claude export zips from the corpus.

    uv run python support/seed/build_exports.py --out DIR     # DIR/chatgpt-seed.zip, claude-seed.zip
    uv run python support/seed/build_exports.py --sync        # refresh tests/fixtures/live/exports
    uv run python support/seed/build_exports.py --check       # fail if the fixtures are stale

The zips are written outside the repository (never commit an archive). ChatGPT's
conversations.json sits one folder deep, like a real export; Claude's sits at the root.
"""

from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path

SEED = Path(__file__).resolve().parent
CORPUS = SEED / "corpus" / "exports"
FIXTURES = SEED.parent.parent / "tests" / "fixtures" / "live" / "exports"
# product -> (corpus file, zip name, path of conversations.json inside the zip)
EXPORTS = {
    "chatgpt": (
        "chatgpt.json",
        "chatgpt-seed.zip",
        "chatgpt-export-seed/conversations.json",
    ),
    "claude": ("claude.json", "claude-seed.zip", "conversations.json"),
}
FIXED_TIME = (2026, 9, 1, 0, 0, 0)


def build(out: Path) -> list[Path]:
    """Write both zips into `out` (created if needed) and return their paths."""
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for source, archive, inside in EXPORTS.values():
        target = out / archive
        member = zipfile.ZipInfo(inside, date_time=FIXED_TIME)
        member.compress_type = zipfile.ZIP_DEFLATED
        with zipfile.ZipFile(target, "w") as bundle:
            bundle.writestr(member, (CORPUS / source).read_bytes())
        written.append(target)
    return written


def sync(check: bool = False) -> list[str]:
    """Copy each corpus JSON to its test fixture; with `check`, only report what differs."""
    stale = []
    for product, (source, _, _) in EXPORTS.items():
        target = FIXTURES / product / "conversations.json"
        wanted = (CORPUS / source).read_bytes()
        if not target.is_file() or target.read_bytes() != wanted:
            stale.append(str(target.relative_to(SEED.parent.parent)))
            if not check:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(wanted)
    return stale


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the synthetic export zips.")
    parser.add_argument("--out", type=Path)
    parser.add_argument("--sync", action="store_true")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    if not (args.out or args.sync or args.check):
        parser.error("give --out, --sync or --check")
    if args.out:
        for path in build(args.out):
            print(path)
    if args.sync or args.check:
        stale = sync(check=args.check)
        for changed in stale:
            print(("stale: " if args.check else "wrote: ") + changed, file=sys.stderr)
        return 1 if args.check and stale else 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
