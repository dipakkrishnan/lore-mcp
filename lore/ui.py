from __future__ import annotations

import os
import sys
import textwrap
from typing import Mapping, TextIO

from .store import Memory, Publication, text_lines

# C0 and C1 controls, and the Unicode line and paragraph separators (CLI-015).
CONTROL_CHARACTERS = dict.fromkeys((*range(32), *range(127, 160), 0x2028, 0x2029))


def clean(text: object) -> str:
    """`text` as a string with C0 and C1 control characters removed.

    Everything remote that reaches the terminal goes through here: card
    titles and bodies, a flag's actor and its diff lines (CLI-013). It is the
    one place to change when tabs are kept rather than deleted (CLI-015).
    A tab is spacing, so it becomes spaces (CLI-015).
    """
    return str(text).expandtabs(4).translate(CONTROL_CHARACTERS)


def COLOR(
    stdout: TextIO | None = None, environ: Mapping[str, str] | None = None
) -> bool:
    """Whether output is painted: a terminal is listening and NO_COLOR is unset.

    Pure given a stream and an environment (XC-105); without them it asks the
    process's own, on every call, so a stream redirected after import is seen."""
    stream = sys.stdout if stdout is None else stdout
    variables = os.environ if environ is None else environ
    return stream.isatty() and "NO_COLOR" not in variables


def paint(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if COLOR() else text


def logo() -> None:
    print(paint("1;36", "◆ Lore"), paint("2", "your context, under your control"))


def heading(text: str) -> None:
    print(f"\n{paint('1', text)}")


def success(text: str) -> None:
    print(paint("32", f"✓ {text}"))


def muted(text: str) -> None:
    print(paint("2", text))


def warn(text: str) -> None:
    print(paint("33", f"! {text}"), file=sys.stderr)


def ask(prompt: str, default: str = "") -> str:
    hint = f" [{default}]" if default else ""
    answer = input(f"{paint('36', '?')} {prompt}{hint}: ").strip()
    return answer or default


def ask_lines(prompt: str) -> str:
    """Read a multi-line answer, ending at EOF (Ctrl-D), not a blank line —
    a real answer can have blank lines between paragraphs."""
    print(f"{paint('36', '?')} {prompt}:")
    return sys.stdin.read().strip()


def confirm(prompt: str, default: bool = True) -> bool:
    hint = "Y/n" if default else "y/N"
    answer = ask(prompt, hint).lower()
    if answer in {"y", "yes"}:
        return True
    if answer in {"n", "no"}:
        return False
    return default


def memory_card(
    memory: Memory, current: int | None = None, total: int | None = None
) -> None:
    label = f"Memory {current} of {total}" if current and total else memory.status
    print(f"\n{paint('2', '─' * 72)}")
    print(paint("1", clean(memory.title)))
    metadata = f"{label} · {memory.source} · {memory.project or 'general'}"
    if memory.source_path and memory.source_path != "agent-session":
        # The locator is the provenance the owner captured; without it the card
        # gives no way back to the file, page, or attachment it came from.
        metadata += f" · {memory.source_path}"
    print(paint("2", clean(metadata)))
    print()
    body = memory.content
    if len(body) > 1800:
        body = body[:1800].rstrip() + "\n…"
    for paragraph in text_lines(body):
        paragraph = clean(paragraph)
        print(textwrap.fill(paragraph, width=78) if paragraph else "")


def changed_memory_note(detail: dict[str, object], labels: dict[str, str]) -> str:
    """Describe what changed behind a flag: which memory, who wrote it, when.

    `origin` distinguishes an agent's own rewrite (`automation`, Lore's
    synthesis) from an owner-side import or capture, so the copy never
    implies the owner edited a memory an agent rewrote.
    """
    if detail["origin"] == "automation":
        actor = "Lore's synthesis"
    else:
        actor = clean(labels.get(str(detail["source"]), str(detail["source"])))
    when = str(detail["updated_at"])[:10]
    title = clean(detail["title"])
    return f'"{title}" was rewritten by {actor} on {when}'


def flag_diff(detail: dict[str, object], labels: dict[str, str]) -> None:
    """Print what changed behind a flag, with a diff where one is available."""
    print(paint("33", f"    ! {changed_memory_note(detail, labels)}"))
    diff = detail.get("diff")
    if not isinstance(diff, list):
        muted(
            "      no snapshot from before this feature shipped — "
            "re-approve to start tracking diffs"
        )
        return
    for line in diff:
        # Clean first, so the colour follows what the owner will see. The
        # store hands over hunks only, so every line is printed.
        line = clean(line)
        if line.startswith("+"):
            print(paint("32", f"      {line}"))
        elif line.startswith("-"):
            print(paint("31", f"      {line}"))
        else:
            print(paint("2", f"      {line}"))


def publication_card(
    publication: Publication, current: int | None = None, total: int | None = None
) -> None:
    label = (
        f"Candidate {current} of {total}"
        if current and total
        else ("active" if publication.active else "revoked")
    )
    if publication.source_changed_at:
        label += " · source changed"
    print(f"\n{paint('2', '─' * 72)}")
    print(paint("1", clean(publication.title)))
    metadata = (
        f"{label} · {publication.kind} · {len(publication.provenance)} source memories"
    )
    if publication.topic:
        # The topic is externally visible wherever discovery groups by it, so it is
        # shown on the approval card: approving the publication approves the label.
        metadata += f" · topic: {publication.topic}"
    print(paint("2", clean(metadata)))
    if publication.teaser:
        # The teaser is the free surface: it is what every buyer reads without
        # paying, so approving the publication approves this advertisement.
        print(paint("2", clean(f"teaser: {publication.teaser}")))
    for label, text in (
        ("useful if", publication.useful_if),
        ("not useful if", publication.not_useful_if),
        ("free sample", publication.sample),
    ):
        if text:
            print(paint("2", clean(f"{label}: {text}")))
    print()
    for paragraph in text_lines(publication.content):
        paragraph = clean(paragraph)
        print(textwrap.fill(paragraph, width=78) if paragraph else "")
