from __future__ import annotations

import os
import sys
import textwrap

from .store import Memory

COLOR = sys.stdout.isatty() and "NO_COLOR" not in os.environ
CONTROL_CHARACTERS = dict.fromkeys((*range(32), *range(127, 160)))


def paint(code: str, text: str) -> str:
    return f"\033[{code}m{text}\033[0m" if COLOR else text


def logo() -> None:
    print(paint("1;36", "◆ Lore"), paint("2", "your context, under your control"))


def heading(text: str) -> None:
    print(f"\n{paint('1', text)}")


def success(text: str) -> None:
    print(paint("32", f"✓ {text}"))


def muted(text: str) -> None:
    print(paint("2", text))


def ask(prompt: str, default: str = "") -> str:
    hint = f" [{default}]" if default else ""
    answer = input(f"{paint('36', '?')} {prompt}{hint}: ").strip()
    return answer or default


def confirm(prompt: str, default: bool = True) -> bool:
    hint = "Y/n" if default else "y/N"
    answer = ask(prompt, hint).lower()
    if answer in {"y", "yes"}:
        return True
    if answer in {"n", "no"}:
        return False
    return default


def memory_card(memory: Memory, current: int | None = None, total: int | None = None) -> None:
    label = f"Memory {current} of {total}" if current and total else memory.status
    print(f"\n{paint('2', '─' * 72)}")
    print(paint("1", memory.title.translate(CONTROL_CHARACTERS)))
    metadata = f"{label} · {memory.source} · {memory.project or 'general'}"
    print(paint("2", metadata.translate(CONTROL_CHARACTERS)))
    print()
    body = memory.content
    if len(body) > 1800:
        body = body[:1800].rstrip() + "\n…"
    for paragraph in body.splitlines():
        paragraph = paragraph.translate(CONTROL_CHARACTERS)
        print(textwrap.fill(paragraph, width=78) if paragraph else "")
