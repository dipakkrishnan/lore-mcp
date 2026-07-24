from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from .paths import home
from .ui import CONTROL_CHARACTERS

BLUEPRINT = "blueprint/blueprint.json"
LORE_MAP = "blueprint/lore-map.md"

MAX_NAME_LENGTH = 200
MAX_TEXT_LENGTH = 1000
MAX_ITEM_LENGTH = 300
MAX_ITEMS = 50

# The persona is a structural archetype, not a voice skin: choosing one seeds the
# organizing axis, depth posture, and section framing for the owner's lore. A new
# persona is one entry here (plus a column in the skill's question table) — nothing
# in normalize()/render_map()/the CLI branches on a specific persona name.
PERSONA_PROFILES = {
    "storyteller": {
        "axis": "chronological",
        "depth_default": "narrative",
        "section_labels": {
            "outline": "Chapters",
            "focus": "Turning points",
            "general": "Backdrop",
            "voice": "How I tell it",
        },
    },
    "schoolteacher": {
        "axis": "theme",
        "depth_default": "broad",
        "section_labels": {
            "outline": "Subjects",
            "focus": "Core lessons",
            "general": "Light touch",
            "voice": "How I teach it",
        },
    },
    "professor": {
        "axis": "knowledge",
        "depth_default": "deep",
        "section_labels": {
            "outline": "Course outline",
            "focus": "Deep dives",
            "general": "Survey level",
            "voice": "How I lecture",
        },
    },
    "executive": {
        "axis": "project",
        "depth_default": "prioritized",
        "section_labels": {
            "outline": "Agenda",
            "focus": "Priorities",
            "general": "Summary-only",
            "voice": "How I brief it",
        },
    },
    "sage": {
        "axis": "theme",
        "depth_default": "distilled",
        "section_labels": {
            "outline": "Teachings",
            "focus": "Deep wisdom",
            "general": "Passing mentions",
            "voice": "How I counsel",
        },
    },
}

PERSONAS = tuple(PERSONA_PROFILES)
AXES = ("chronological", "theme", "project", "knowledge")

# Fields the skill may send. Anything else — including the command-authored fields
# below (captured_at, depth_default, section_labels) — is rejected, so a future
# schema addition is a deliberate, additive change to this set, never a silent
# passthrough of untrusted input.
_REQUIRED_FIELDS = {"version", "name", "persona", "topic_outline", "storytelling"}
_OPTIONAL_FIELDS = {"organizing_axis", "focus_topics", "general_areas"}
_ACCEPTED_FIELDS = _REQUIRED_FIELDS | _OPTIONAL_FIELDS


def blueprint_path() -> Path:
    """Return the owner-local blueprint artifact path."""
    return home() / BLUEPRINT


def lore_map_path() -> Path:
    """Return the owner-local human-readable lore map path."""
    return home() / LORE_MAP


def load_blueprint() -> dict | None:
    """Load the persisted blueprint, or None if it has never been captured."""
    path = blueprint_path()
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _clean_text(value: object, field: str, *, max_length: int) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be a string")
    cleaned = value.translate(CONTROL_CHARACTERS).strip()
    if not cleaned:
        raise ValueError(f"{field} cannot be empty")
    if len(cleaned) > max_length:
        raise ValueError(f"{field} cannot exceed {max_length} characters")
    return cleaned


def _clean_list(value: object, field: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{field} must be a list")
    if len(value) > MAX_ITEMS:
        raise ValueError(f"{field} cannot exceed {MAX_ITEMS} items")
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in value:
        if not isinstance(item, str):
            raise ValueError(f"{field} items must be strings")
        text = item.translate(CONTROL_CHARACTERS).strip()
        if not text or text in seen:
            continue
        if len(text) > MAX_ITEM_LENGTH:
            raise ValueError(f"{field} items cannot exceed {MAX_ITEM_LENGTH} characters")
        seen.add(text)
        cleaned.append(text)
    return cleaned


def normalize(raw: dict) -> dict:
    """Validate untrusted interview input and resolve persona-derived structure.

    Returns the canonical, self-contained blueprint: the persona's organizing axis
    (or the owner's override), depth posture, and section labels are resolved and
    written into the result, so a future reader never needs PERSONA_PROFILES itself.
    """
    if not isinstance(raw, dict):
        raise ValueError("blueprint must be a JSON object")

    unexpected = set(raw) - _ACCEPTED_FIELDS
    if unexpected:
        raise ValueError(f"unexpected blueprint field: {sorted(unexpected)[0]}")
    missing = _REQUIRED_FIELDS - set(raw)
    if missing:
        raise ValueError(f"missing blueprint field: {sorted(missing)[0]}")

    if raw.get("version") != 1:
        raise ValueError(f"unsupported blueprint version: {raw.get('version')!r}")

    persona = raw["persona"]
    if persona not in PERSONA_PROFILES:
        raise ValueError(f"unknown persona: {persona!r}")
    profile = PERSONA_PROFILES[persona]

    axis = raw.get("organizing_axis", profile["axis"])
    if axis not in AXES:
        raise ValueError(f"unknown organizing axis: {axis!r}")

    name = _clean_text(raw["name"], "name", max_length=MAX_NAME_LENGTH)
    storytelling = _clean_text(raw["storytelling"], "storytelling", max_length=MAX_TEXT_LENGTH)
    topic_outline = _clean_list(raw["topic_outline"], "topic_outline")
    if not topic_outline:
        raise ValueError("topic_outline cannot be empty")
    focus_topics = _clean_list(raw.get("focus_topics"), "focus_topics")
    general_areas = _clean_list(raw.get("general_areas"), "general_areas")

    captured_at = (
        datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    )
    return {
        "version": 1,
        "captured_at": captured_at,
        "name": name,
        "persona": persona,
        "organizing_axis": axis,
        "depth_default": profile["depth_default"],
        "section_labels": dict(profile["section_labels"]),
        "topic_outline": topic_outline,
        "focus_topics": focus_topics,
        "general_areas": general_areas,
        "storytelling": storytelling,
    }


def save_blueprint(blueprint: dict) -> None:
    """Persist the blueprint and its human-readable map as owner-private files."""
    directory = blueprint_path().parent
    # The blueprint captures durable personal context; keep it owner-only.
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)

    path = blueprint_path()
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(json.dumps(blueprint, indent=2, allow_nan=False) + "\n", encoding="utf-8")

    map_path = lore_map_path()
    map_path.touch(mode=0o600, exist_ok=True)
    map_path.chmod(0o600)
    map_path.write_text(render_map(blueprint), encoding="utf-8")


def render_map(blueprint: dict) -> str:
    """Render a persona-framed, human-readable lore map from a normalized blueprint."""
    labels = blueprint["section_labels"]
    lines = [
        f"# Lore map — {blueprint['persona'].title()} {blueprint['name']}",
        "",
        f"_Captured {blueprint['captured_at'][:10]}. "
        f"Organized by {blueprint['organizing_axis']}._",
        "",
        f"## {labels['outline']}",
    ]
    lines.extend(f"- {item}" for item in blueprint["topic_outline"])
    if blueprint["focus_topics"]:
        lines += ["", f"## {labels['focus']}"]
        lines.extend(f"- {item}" for item in blueprint["focus_topics"])
    if blueprint["general_areas"]:
        lines += ["", f"## {labels['general']}"]
        lines.extend(f"- {item}" for item in blueprint["general_areas"])
    lines += ["", f"## {labels['voice']}", blueprint["storytelling"]]
    return "\n".join(lines) + "\n"


def apply(file: Path) -> dict:
    """Read a blueprint JSON file, validate and normalize it, and persist it.

    This is the single write path for the blueprint artifact: the interviewing
    agent hands over a file rather than writing `~/.lore/blueprint/*` directly.
    """
    try:
        raw = json.loads(Path(file).read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise OSError(f"blueprint file not found: {file}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"blueprint file is not valid JSON: {error}") from error
    blueprint = normalize(raw)
    save_blueprint(blueprint)
    return blueprint
