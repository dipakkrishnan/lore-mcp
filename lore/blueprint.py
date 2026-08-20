from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field, field_validator

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
Persona = Literal["storyteller", "schoolteacher", "professor", "executive", "sage"]
Axis = Literal["chronological", "theme", "project", "knowledge"]


class SectionLabels(TypedDict):
    outline: str
    focus: str
    general: str
    voice: str


class PersonaProfile(TypedDict):
    axis: Axis
    depth_default: str
    section_labels: SectionLabels


PERSONA_PROFILES: dict[Persona, PersonaProfile] = {
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
_CONTROLS_TO_SPACES = dict.fromkeys(CONTROL_CHARACTERS, " ")


class BlueprintInput(BaseModel):
    """Owner-approved shape crossing the onboarding/CLI boundary."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    version: Literal[1]
    name: str = Field(min_length=1, max_length=MAX_NAME_LENGTH)
    persona: Persona
    organizing_axis: Axis | None = None
    topic_outline: list[str] = Field(min_length=1, max_length=MAX_ITEMS)
    focus_topics: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    general_areas: list[str] = Field(default_factory=list, max_length=MAX_ITEMS)
    storytelling: str = Field(min_length=1, max_length=MAX_TEXT_LENGTH)

    @field_validator("name", "storytelling", mode="before")
    @classmethod
    def clean_text(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.translate(_CONTROLS_TO_SPACES).split())

    @field_validator("topic_outline", "focus_topics", "general_areas", mode="before")
    @classmethod
    def clean_items(cls, value: object) -> object:
        if value is None:
            return []
        if not isinstance(value, list):
            return value
        if len(value) > MAX_ITEMS:
            raise ValueError(f"blueprint lists cannot exceed {MAX_ITEMS} items")
        cleaned: list[object] = []
        seen: set[str] = set()
        for item in value:
            if not isinstance(item, str):
                cleaned.append(item)
                continue
            item = " ".join(item.translate(_CONTROLS_TO_SPACES).split())
            if not item or item in seen:
                continue
            if len(item) > MAX_ITEM_LENGTH:
                raise ValueError(
                    f"blueprint items cannot exceed {MAX_ITEM_LENGTH} characters"
                )
            seen.add(item)
            cleaned.append(item)
        return cleaned


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
    blueprint = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(blueprint, dict):
        raise ValueError("saved blueprint must be a JSON object")
    return blueprint


def normalize(raw: object) -> dict:
    """Validate untrusted interview input and resolve persona-derived structure.

    Returns the canonical, self-contained blueprint: the persona's organizing axis
    (or the owner's override), depth posture, and section labels are resolved and
    written into the result, so a future reader never needs PERSONA_PROFILES itself.
    """
    data = BlueprintInput.model_validate(raw)
    persona = data.persona
    profile = PERSONA_PROFILES[persona]
    axis = data.organizing_axis or profile["axis"]

    captured_at = (
        datetime.now(timezone.utc)
        .replace(microsecond=0)
        .isoformat()
        .replace("+00:00", "Z")
    )
    return {
        "version": 1,
        "captured_at": captured_at,
        "name": data.name,
        "persona": persona,
        "organizing_axis": axis,
        "depth_default": profile["depth_default"],
        "section_labels": dict(profile["section_labels"]),
        "topic_outline": data.topic_outline,
        "focus_topics": data.focus_topics,
        "general_areas": data.general_areas,
        "storytelling": data.storytelling,
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
    path.write_text(
        json.dumps(blueprint, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )

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
