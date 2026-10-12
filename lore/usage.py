"""Anonymous usage events (APP-058): where installs get to, never what is in them.

Each event is a closed name with at most one coded property, sent with the
install's random id and the app version. A milestone is sent once per install
(so nothing reveals how much someone has written), `app.opened` once a day,
and `cli.failed` each time. Nothing is sent until the owner has seen the
notice, and nothing at all with telemetry off. Every event sent is also
appended to a local log the owner can read. Sending is best-effort and never
blocks or fails a command. The relay re-checks every event against the same
list (contracts/usage_events.json) before passing it on.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
import urllib.request
from datetime import datetime, timezone

from . import __version__, feedback
from .paths import home
from .store import Store

ENABLED_SETTING = "telemetry_enabled"
NOTICED_SETTING = "telemetry_noticed"
SENT_SETTING = "usage_sent"
LOG_KEEP = 500
TIMEOUT_SECONDS = 2.0

CONNECTORS = (
    "obsidian",
    "chatgpt",
    "claude",
    "substack",
    "medium",
    "bluesky",
    "blog",
    "granola",
    "notion",
    "readwise",
    "folder",
    "feed",
    "agents",
)
COMMANDS = (
    "setup",
    "sync",
    "sources",
    "capture",
    "publication",
    "collection",
    "sell",
    "feed",
    "price",
    "push",
    "node",
    "marketplace",
    "cards",
    "report-feedback",
    "other",
)
# name -> (how often it is sent, the one property it may carry and its values)
EVENTS: dict[str, tuple[str, tuple[str, tuple[str, ...]] | None]] = {
    "app.opened": ("daily", None),
    "signin.completed": ("once", None),
    "source.connected": ("once", ("connector", CONNECTORS)),
    "memory.saved": ("once", None),
    "piece.approved": ("once", None),
    "store.opened": ("once", None),
    "store.listed": ("once", None),
    "sale.seen": ("once", ("via", ("card", "agent"))),
    "cli.failed": ("always", ("command", COMMANDS)),
}


def log_path() -> str:
    return str(home() / "usage.log")


def notice_shown() -> None:
    with Store() as store:
        store.set_setting(NOTICED_SETTING, True)


def record(name: str, value: str = "") -> bool:
    """Send one event if it is allowed, due and consented to; True if sent.
    Never fails the command that observed it."""
    frequency, prop = EVENTS[name]
    if prop and value not in prop[1]:
        raise ValueError(f"{name} can't carry {value!r}")
    try:
        return _record(name, frequency, {prop[0]: value} if prop else {}, value)
    except (OSError, sqlite3.Error):
        return False


def _record(name: str, frequency: str, props: dict[str, str], value: str) -> bool:
    key = f"{name}:{value}" if frequency == "once" else name
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    with Store() as store:
        if store.setting(ENABLED_SETTING, True) is False:
            return False
        if store.setting(NOTICED_SETTING, False) is not True:
            return False
        sent = store.setting(SENT_SETTING, {})
        sent = sent if isinstance(sent, dict) else {}
        if frequency == "once" and key in sent:
            return False
        if frequency == "daily" and sent.get(key) == today:
            return False
        if frequency != "always":
            store.set_setting(SENT_SETTING, sent | {key: today})
    event: dict[str, object] = {
        "name": name,
        "props": props,
        "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    _log(event)
    _send(event)
    return True


def _log(event: dict[str, object]) -> None:
    path = log_path()
    try:
        with open(path, encoding="utf-8") as handle:
            lines = handle.readlines()[-(LOG_KEEP - 1) :]
    except OSError:
        lines = []
    lines.append(json.dumps(event) + "\n")
    with open(path, "w", encoding="utf-8") as handle:
        handle.writelines(lines)


def _url() -> str | None:
    override = os.environ.get("LORE_USAGE_URL")
    if override:
        return override
    relay = feedback.RELAY_URL
    return relay.rsplit("/", 1)[0] + "/events" if relay else None


def _send(event: dict[str, object]) -> None:
    url = _url()
    if not url:
        return
    body = json.dumps(
        {
            "install_id": feedback.install_id(),
            "version": os.environ.get("LORE_APP_VERSION", __version__),
            "events": [event],
        }
    ).encode()
    request = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "User-Agent": feedback.USER_AGENT},
    )

    def post() -> None:
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS):
                pass
        except OSError:
            pass

    # Not a daemon: the command finishes its own work first, then waits at
    # most TIMEOUT_SECONDS for this before the process exits.
    threading.Thread(target=post).start()
