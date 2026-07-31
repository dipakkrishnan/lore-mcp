"""On-disk storage for payment secrets.

Two secrets live here: the Coinbase CDP key secret, which signs facilitator calls,
and the test buyer's private key, which pays for the one testnet transaction that
proves the path works. Both are deliberately kept away from everything else Lore
writes:

- not ``lore.db``, which holds memory content and is the file an owner is most
  likely to copy, back up, or hand to a deployed node;
- not anything under ``$LORE_HOME/automation/``, which is what synthesis reads.

They live in one ``0600`` file that only :func:`save` writes and only :func:`load`
reads. No command takes either as an argument and no output ever prints one, so
neither lands in a shell history or an agent transcript.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from ..paths import home

CDP_KEY_ID = "cdp_api_key_id"
CDP_KEY_SECRET = "cdp_api_key_secret"
TEST_BUYER_KEY = "test_buyer_key"

FIELDS = (CDP_KEY_ID, CDP_KEY_SECRET, TEST_BUYER_KEY)

# Which fields are secret, and therefore never printed, logged, or echoed back.
SECRETS = frozenset({CDP_KEY_SECRET, TEST_BUYER_KEY})


def path() -> Path:
    """Return the credential file's location."""
    return home() / "payment.json"


def load() -> dict[str, str]:
    """Return stored credentials, or an empty mapping when none are stored."""
    try:
        raw = path().read_text(encoding="utf-8")
    except (FileNotFoundError, NotADirectoryError):
        return {}
    try:
        stored = json.loads(raw)
    except json.JSONDecodeError:
        raise ValueError(f"{path()} is not valid JSON; delete it and re-run `lore payment auth`")
    if not isinstance(stored, dict):
        raise ValueError(f"{path()} must contain a JSON object")
    return {
        field: str(stored[field]).strip()
        for field in FIELDS
        if stored.get(field) not in (None, "")
    }


def save(**values: str) -> Path:
    """Merge credentials into the 0600 file, leaving unnamed fields untouched."""
    unknown = set(values) - set(FIELDS)
    if unknown:
        raise ValueError(f"unknown credential field: {sorted(unknown)[0]}")
    merged = load()
    for field, value in values.items():
        value = (value or "").strip()
        if not value:
            raise ValueError(f"{field.replace('_', ' ')} must not be empty")
        merged[field] = value

    destination = path()
    destination.parent.mkdir(parents=True, exist_ok=True)
    # Open with the mode set so the secret is never briefly world-readable.
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(merged))
    os.chmod(destination, 0o600)  # An existing file would otherwise keep its old mode.
    return destination


def clear() -> bool:
    """Remove every stored credential, reporting whether there were any."""
    try:
        path().unlink()
    except FileNotFoundError:
        return False
    return True


def configured() -> dict[str, bool]:
    """Report which credentials are present — never what they are."""
    stored = load()
    return {field: bool(stored.get(field)) for field in FIELDS}
