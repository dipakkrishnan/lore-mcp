"""Resumable state for an onboarding that spans a CLI, an agent, and a scheduler.

Onboarding is not one command: `lore setup` imports, an agent interview captures the
blueprint and drafts the profile, and only then does the owner classify anything. Any
of those can be interrupted, so the progress below is derived from the artifacts that
actually exist — never from a flag some step remembered to set. The one piece that
cannot be derived, the half-finished interview, lives in the checkpoint.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from . import automation, blueprint
from .paths import home
from .store import Store

CHECKPOINT = "automation/onboarding.json"

# The interview records the answers a profile is made of, plus its own phase flag.
# Anything else — session content above all — is rejected rather than stored.
FLAGS = ("phase1_done",)
ACCEPTED_FIELDS = frozenset(automation.PROFILE_FIELDS) | frozenset(FLAGS)

HANDOFF = 'tell Claude or Codex "Onboard me to Lore."'


@dataclass(frozen=True)
class Step:
    """One onboarding step, with the evidence that decided its state."""

    label: str
    done: bool
    detail: str


def checkpoint_path() -> Path:
    """Return the owner-local onboarding checkpoint path."""
    return home() / CHECKPOINT


def load_checkpoint() -> dict:
    """Load the in-flight interview answers, or an empty dict before the first one."""
    path = checkpoint_path()
    if not path.exists():
        return {}
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise ValueError("onboarding checkpoint is not a JSON object")
    return data


def save_checkpoint(answers: dict) -> dict:
    """Merge one round of interview answers into the checkpoint and persist it.

    This is the single write path for the checkpoint, mirroring `blueprint apply` and
    `lore profile`: the interviewing agent hands over answers instead of writing
    `~/.lore` itself. Merging is what makes the interview resumable — an agent can
    save each answer as it is given without resending the ones before it.
    """
    if not isinstance(answers, dict):
        raise ValueError("onboarding answers must be a JSON object")
    if not answers:
        raise ValueError("onboarding answers cannot be empty")
    unexpected = set(answers) - ACCEPTED_FIELDS
    if unexpected:
        raise ValueError(f"unexpected onboarding field: {sorted(unexpected)[0]}")
    for flag in FLAGS:
        if flag in answers and not isinstance(answers[flag], bool):
            raise ValueError(f"onboarding {flag} must be true or false")
    try:
        existing = load_checkpoint()
    except ValueError as error:
        # Merging into a file we cannot parse would silently drop earlier answers.
        raise ValueError(
            f"onboarding checkpoint at {checkpoint_path()} is unreadable ({error}); "
            "delete it to start the interview over"
        ) from error
    given = {key: value for key, value in answers.items() if value is not None}
    checkpoint = automation.check_fields({**existing, **given})

    path = checkpoint_path()
    directory = path.parent
    # The checkpoint holds draft personal context the owner has not approved yet.
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    directory.chmod(0o700)
    path.touch(mode=0o600, exist_ok=True)
    path.chmod(0o600)
    path.write_text(json.dumps(checkpoint, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    return checkpoint


def _saved_profile() -> dict | None:
    path = automation.profile_path()
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def _artifact(read: Callable[[], dict | None]) -> tuple[dict | None, bool]:
    """Load an onboarding artifact, reporting an unreadable one instead of raising.

    `lore status` and `lore onboarding` are how an owner finds their way back into an
    interrupted setup, so a hand-edited or truncated file has to read as a step to
    redo — never as a crashed command with nothing to act on.
    """
    try:
        data = read()
    except (OSError, ValueError):
        return None, False
    if data is not None and not isinstance(data, dict):
        return None, False
    return data, True


def _missing(absent: str, readable: bool) -> str:
    return absent if readable else "unreadable — redo this step to replace it"


def progress() -> tuple[list[Step], str, list[str]]:
    """Report every onboarding step, the command that advances the owner, and any
    condition that needs saying even though no step is blocked on it."""
    with Store() as store:
        counts = store.counts()
        sources = set(store.setting("sources", []))
    total = sum(counts.values())
    shape, shape_read = _artifact(blueprint.load_blueprint)
    profile, profile_read = _artifact(_saved_profile)
    checkpoint, checkpoint_read = _artifact(load_checkpoint)

    imported = Step(
        "Import agent memories",
        bool(sources) or total > 0,
        f"{total} {'memory' if total == 1 else 'memories'} imported"
        if sources or total
        else "`lore setup` has not run",
    )
    captured = Step(
        "Capture your lore blueprint",
        shape is not None,
        f"{str(shape.get('persona', 'lore')).title()} {shape.get('name', '')}".strip()
        if shape
        else _missing("the persona interview has not run", shape_read),
    )
    # A saved profile is not a running schedule; ask the scheduler which it is.
    running = profile is not None and automation.scheduled(profile)
    drafted = Step(
        "Draft your synthesis profile",
        profile is not None,
        (
            f"{str(profile.get('executor', '')).title()} synthesis, "
            f"{profile.get('cadence', 'daily')} at {int(profile.get('hour', 21)):02d}:00"
            if running
            else "profile saved, but no local task is installed"
        )
        if profile
        else _missing("scheduled synthesis is not configured", profile_read),
    )
    # Nothing pending is a finished step, not a skipped one: synthesis fills an empty
    # library later, and there is no disclosure decision to make until it does.
    classified = Step(
        "Classify what stays private",
        counts["pending"] == 0,
        f"{counts['pending']} awaiting review"
        if counts["pending"]
        else ("nothing waiting" if total else "nothing imported yet"),
    )

    steps = [imported, captured, drafted, classified]
    if not imported.done:
        step = "Run `lore setup` to import the memories your agents already wrote."
    elif not (captured.done and drafted.done):
        if not checkpoint_read:
            # No step is backed by the checkpoint, so its damage surfaces here or
            # nowhere — and it only blocks while the interview is still unfinished.
            step = f"Delete the unreadable checkpoint at {checkpoint_path()}, then {HANDOFF}"
        else:
            started = captured.done or bool(checkpoint)
            step = f"{'Resume' if started else 'Start'} onboarding — {HANDOFF}"
    elif not classified.done:
        step = "Run `lore review` to decide what stays private and what can be answered."
    else:
        step = ""

    # Classification is the better next action while memories wait, but an absent
    # schedule means the library stops growing — that cannot wait silently for it.
    warnings = []
    if profile is not None and not running:
        warnings.append(
            f"No synthesis is scheduled. Run `lore profile {automation.profile_path()}` "
            "to install it, or ignore this if you schedule synthesis yourself."
        )
    return steps, step, warnings
