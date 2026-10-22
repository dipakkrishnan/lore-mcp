"""Build the seed blog (a Cloudflare Pages static site) from the corpus JSON files.

    uv run python support/seed/build_blog.py            # rewrite corpus/blog/
    uv run python support/seed/build_blog.py --check    # fail if corpus/blog/ is stale
    uv run python support/seed/build_blog.py --out DIR  # build somewhere else

Sources of truth: corpus/blog.json (the public blog), corpus/substack.json and
corpus/medium.json (the posts the two importers consume). Everything here is
fictional; see persona.md.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from email.utils import format_datetime
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape

SEED = Path(__file__).resolve().parent
CORPUS = SEED / "corpus"
DISCLAIMER = (
    "Seed site for the Lore connector test suite (tidewell-seed). "
    "Every name and number here is invented."
)


def _load(name: str) -> dict[str, Any]:
    data = json.loads((CORPUS / name).read_text(encoding="utf-8"))
    assert isinstance(data, dict)
    return data


def _rfc2822(day: str) -> str:
    year, month, date = (int(part) for part in day.split("-"))
    return format_datetime(datetime(year, month, date, 9, 0, tzinfo=timezone.utc))


def _cdata(html: str) -> str:
    return "<![CDATA[" + html.replace("]]>", "]]]]><![CDATA[>") + "]]>"


def _item(post: dict[str, Any], link: str) -> str:
    title = escape(post["title"])
    if post.get("format") == "description":
        body = f"<description>{escape(post['html'])}</description>"
    else:
        body = f"<content:encoded>{_cdata(post['html'])}</content:encoded>"
    return (
        "    <item>\n"
        f"      <title>{title}</title>\n"
        f"      <link>{link}</link>\n"
        f'      <guid isPermaLink="true">{link}</guid>\n'
        f"      <pubDate>{_rfc2822(post['date'])}</pubDate>\n"
        f"      {body}\n"
        "    </item>\n"
    )


def _rss(title: str, home: str, description: str, items: list[str]) -> str:
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">\n'
        "  <channel>\n"
        f"    <title>{escape(title)}</title>\n"
        f"    <link>{home}</link>\n"
        f"    <description>{escape(description)}</description>\n"
        + "".join(items)
        + "  </channel>\n</rss>\n"
    )


def _page(title: str, body: str, noindex: bool = False) -> str:
    robots = '  <meta name="robots" content="noindex">\n' if noindex else ""
    return (
        "<!doctype html>\n"
        '<html lang="en">\n<head>\n'
        '  <meta charset="utf-8">\n'
        f"{robots}"
        f"  <title>{escape(title)}</title>\n"
        "</head>\n<body>\n"
        f"{body}\n"
        "</body>\n</html>\n"
    )


def build() -> dict[str, str]:
    """Return every file of the site, keyed by its path under the site root."""
    blog = _load("blog.json")
    site = blog["site"]
    home = site["url"]
    posts = sorted(blog["posts"], key=lambda p: p["date"], reverse=True)
    files: dict[str, str] = {}

    listing = "\n".join(
        f'  <li><a href="/posts/{p["slug"]}.html">{escape(p["title"])}</a> '
        f"<small>{p['date']}</small></li>"
        for p in posts
    )
    files["index.html"] = (
        "<!doctype html>\n"
        '<html lang="en">\n<head>\n'
        '  <meta charset="utf-8">\n'
        f"  <title>{escape(site['title'])}</title>\n"
        '  <link rel="alternate" type="application/rss+xml" '
        f'title="{escape(site["title"])}" href="/feed.xml">\n'
        "</head>\n<body>\n"
        f"<h1>{escape(site['title'])}</h1>\n"
        f"<p>{escape(site['description'])}</p>\n"
        f"<ul>\n{listing}\n</ul>\n"
        f"<p><small>{DISCLAIMER}</small></p>\n"
        "</body>\n</html>\n"
    )
    files["feed.xml"] = _rss(
        site["title"],
        home,
        site["description"],
        [_item(p, f"{home}/posts/{p['slug']}.html") for p in posts],
    )
    files["robots.txt"] = "User-agent: *\nDisallow: /\n"
    for p in posts:
        files[f"posts/{p['slug']}.html"] = _page(
            p["title"],
            f"<article>\n<h1>{escape(p['title'])}</h1>\n{p['html']}\n</article>\n"
            f"<p><small>{DISCLAIMER}</small></p>",
        )

    # Unlinked pages the Substack and Medium importers consume; never advertised
    # from index.html, so Lore's feed autodiscovery cannot see them.
    substack = _load("substack.json")
    sub_home = f"{home}/import/substack"
    files["import/substack.xml"] = _rss(
        substack["publication"]["name"],
        sub_home,
        f"Import feed. {DISCLAIMER}",
        [
            _item(
                {**p, "format": "encoded"},
                f"{sub_home}/{p['slug']}",
            )
            for p in sorted(substack["posts"], key=lambda p: p["date"], reverse=True)
        ],
    )
    for story in _load("medium.json")["stories"]:
        files[f"import/medium/{story['slug']}.html"] = _page(
            story["title"],
            f"<article>\n<h1>{escape(story['title'])}</h1>\n{story['html']}\n</article>",
            noindex=True,
        )
    return files


def write(out: Path, files: dict[str, str]) -> None:
    for rel, text in files.items():
        path = out / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="utf-8")


def stale(out: Path, files: dict[str, str]) -> list[str]:
    """Paths whose committed text differs from what the corpus would build."""
    wrong = [
        rel
        for rel, text in files.items()
        if not (out / rel).is_file() or (out / rel).read_text(encoding="utf-8") != text
    ]
    extra = [
        str(path.relative_to(out))
        for path in out.rglob("*")
        if path.is_file() and str(path.relative_to(out)) not in files
    ]
    return sorted(wrong + extra)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build the seed blog site.")
    parser.add_argument("--out", type=Path, default=CORPUS / "blog")
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args(argv)
    files = build()
    if args.check:
        wrong = stale(args.out, files)
        for rel in wrong:
            print(f"stale: {rel}", file=sys.stderr)
        return 1 if wrong else 0
    write(args.out, files)
    print(f"wrote {len(files)} files to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
