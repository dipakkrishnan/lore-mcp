"""Send owner feedback to the Lore maintainers as a GitHub issue (XC-028).

Both `lore report-feedback` (CLI) and the Desktop app's Report Feedback
dialog go through this module and nothing else. Neither surface talks to the
relay directly, builds a `Report` by hand, or skips the local spool — that is
what keeps their behavior identical and keeps a network failure from losing
what the owner typed.

The relay is a small Cloudflare Worker the maintainers operate
(`feedback-relay/`), holding a token that can create issues on
`dipakkrishnan/lore-mcp`. Owners never hold that token; this module only ever
sends it one report at a time and gets back a receipt. Field limits are
shared with the relay's own validation via `contracts/feedback_report.json`
(MCP-002's `contracts/mcp_tools.json` is the precedent for a contract two
languages both assert against).
"""

from __future__ import annotations

import json
import os
import platform
import re
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from . import __version__
from .paths import home
from .store import Store
from .ui import CONTROL_CHARACTERS

Source = Literal["cli", "desktop"]

# None until a maintainer has actually deployed the relay and pinned its
# address here. That pinning is the one switch that turns this feature on:
# with no address, `lore report-feedback` refuses before it prompts and the
# Desktop app hides its button, so no release can ship a Send that 502s
# against an endpoint nobody configured. Once pinned, every installed copy
# POSTs here forever, so it only ever changes by shipping a new version —
# never by editing the relay's own address. LORE_FEEDBACK_URL exists for
# tests and for smoking a freshly deployed relay before pinning it here.
RELAY_URL: str | None = None
RELAY_ENV = "LORE_FEEDBACK_URL"

REPORT_VERSION: Literal[1] = 1
TIMEOUT_SECONDS = 10.0
USER_AGENT = f"Lore/{__version__}"
INSTALL_ID_SETTING = "install_id"
# Bounds the local spool so an offline retry loop cannot fill a disk.
SPOOL_KEEP = 50
# How many same-second filenames to try before giving up. Reached only if a
# thousand reports share one second, which is not a real submission pattern.
SPOOL_ATTEMPTS = 1000

# Match lore/capture.py's title/content caps: a feedback report is the same
# shape of owner-authored text as a memory, so it gets the same limits.
# These count code points, which is why the relay counts code points too
# rather than JavaScript's default UTF-16 code units — see
# contracts/feedback_report.json's length_unit.
MAX_TITLE = 200
MAX_DESCRIPTION = 20_000
MAX_EMAIL = 254
# The relay's own cap on a request body, shared through the contract. Not
# enforced here: it is deliberately above the largest body these field caps
# can produce (20,000 four-byte code points plus title, email, metadata and
# JSON framing), so nothing this module accepts can come back a 413.
# tests/test_feedback.py proves that headroom rather than trusting it.
MAX_BODY_BYTES = 131_072
TIMESTAMP = "%Y-%m-%dT%H:%M:%SZ"

_INSTALL_ID_RE = re.compile(r"^[0-9a-f]{32}$")
_CONTROLS_TO_SPACES = dict.fromkeys(CONTROL_CHARACTERS, " ")
_CONTENT_CONTROLS = _CONTROLS_TO_SPACES | {ord("\n"): "\n"}


class ReportMetadata(BaseModel):
    """Machine facts attached to a report. Every field here is disclosed in a
    public GitHub issue; nothing here is derived from the owner's library."""

    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)

    submitted_at: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
    source: Source
    lore_version: str = Field(min_length=1, max_length=64)
    platform: str = Field(min_length=1, max_length=200)
    arch: str = Field(min_length=1, max_length=64)
    python_version: str = Field(min_length=1, max_length=64)
    install_id: str = Field(pattern=r"^[0-9a-f]{32}$")


class Report(BaseModel):
    """One feedback report as it crosses the wire to the relay."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    report_version: Literal[1] = REPORT_VERSION
    title: str = Field(min_length=1, max_length=MAX_TITLE)
    email: str | None = Field(default=None, max_length=MAX_EMAIL)
    description: str = Field(min_length=1, max_length=MAX_DESCRIPTION)
    metadata: ReportMetadata

    @field_validator("title", mode="before")
    @classmethod
    def clean_title(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        return " ".join(value.translate(_CONTROLS_TO_SPACES).split())

    @field_validator("email", mode="before")
    @classmethod
    def clean_email(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        cleaned = " ".join(value.translate(_CONTROLS_TO_SPACES).split())
        return cleaned or None

    @field_validator("description", mode="before")
    @classmethod
    def clean_description(cls, value: object) -> object:
        if not isinstance(value, str):
            return value
        value = value.replace("\r\n", "\n").replace("\r", "\n")
        return value.translate(_CONTENT_CONTROLS).strip()

    @field_validator("email")
    @classmethod
    def plausible_email(cls, value: str | None) -> str | None:
        # Deliberately not RFC 5322: an over-strict check rejects real
        # addresses, and the relay has to duplicate whatever we pick anyway.
        # Optional — a report with no reply address is still worth having.
        if value is None:
            return value
        if " " in value or value.count("@") != 1:
            raise ValueError("that doesn't look like an email address")
        local, domain = value.split("@")
        if (
            not local
            or "." not in domain
            or domain.startswith(".")
            or domain.endswith(".")
        ):
            raise ValueError("that doesn't look like an email address")
        return value


class Receipt(BaseModel):
    """What the relay says it did with a report."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    ok: bool
    issue_url: str
    issue_number: int


def install_id() -> str:
    """Return this installation's anonymous id, minting it on first use.

    Lives in the settings table Store already owns (lore/store.py), not a
    separate file — lore/paths.py has no config-file concept of its own. A
    corrupted or missing value is re-minted rather than raised: a broken
    setting must never make feedback impossible.
    """
    with Store() as store:
        value = store.setting(INSTALL_ID_SETTING, None)
        if isinstance(value, str) and _INSTALL_ID_RE.fullmatch(value):
            return value
        minted = secrets.token_hex(16)
        store.set_setting(INSTALL_ID_SETTING, minted)
        return minted


def _platform_string() -> str:
    return f"{platform.system()} {platform.release()}".strip() or "unknown"


def _machine() -> str:
    return platform.machine() or "unknown"


def _python_version() -> str:
    return platform.python_version() or "unknown"


def collect_metadata(source: Source) -> ReportMetadata:
    """Gather non-identifying facts about this run for a feedback report.

    Deliberately excludes hostname, username, and any path — the same rule
    docs/manual-test-runs/README.md states for what belongs in a run record.
    """
    return ReportMetadata(
        submitted_at=datetime.now(timezone.utc).strftime(TIMESTAMP),
        source=source,
        lore_version=__version__,
        platform=_platform_string(),
        arch=_machine(),
        python_version=_python_version(),
        install_id=install_id(),
    )


def _summarize(error: ValidationError) -> str:
    first = error.errors()[0]
    field = ".".join(str(part) for part in first["loc"])
    message = first["msg"]
    prefix = "Value error, "
    if message.startswith(prefix):
        message = message[len(prefix) :]
    return f"{field}: {message}"


def build(*, title: str, email: str | None, description: str, source: Source) -> Report:
    """Validate owner-entered text and attach machine metadata."""
    try:
        return Report(
            title=title,
            email=email,
            description=description,
            metadata=collect_metadata(source),
        )
    except ValidationError as error:
        raise ValueError(_summarize(error)) from error


def relay_url() -> str:
    """The relay endpoint. The override exists for tests and for smoking a
    freshly deployed relay; it is not a user-facing setting.

    Raises when no relay has been pinned yet (see RELAY_URL) rather than
    guessing an address, so both surfaces can refuse early and identically.
    """
    url = os.environ.get(RELAY_ENV) or RELAY_URL
    if not url:
        raise ValueError(
            "sending feedback is not wired up in this build yet; "
            "see feedback-relay/README.md"
        )
    local = url.startswith("http://127.0.0.1:") or url.startswith("http://localhost:")
    if not (url.startswith("https://") or local):
        raise ValueError(f"the feedback service address must be https: {url}")
    return url


def available() -> bool:
    """Whether this build can send feedback at all. Drives the CLI's early
    refusal and the Desktop app's decision to show its button."""
    try:
        relay_url()
    except ValueError:
        return False
    return True


def spool_dir() -> Path:
    path = home() / "feedback"
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    return path


def allocate_spool_path(report: Report) -> Path:
    """Claim a fresh file for one submission, creating it empty.

    `submitted_at` has one-second precision and `install_id` is fixed for an
    installation, so a name built from those alone collides between two
    reports sent in the same second — and PRIVACY.md promises every sent
    report is kept. The timestamp stays leading because `_prune_spool()`
    sorts names lexicographically to find the oldest; the counter breaks
    same-second ties, and O_EXCL makes "fresh" a guarantee rather than a
    probability even with two processes spooling at once.
    """
    stamp = report.metadata.submitted_at.replace(":", "")
    directory = spool_dir()
    for index in range(SPOOL_ATTEMPTS):
        path = directory / f"{stamp}-{index:03d}.json"
        try:
            os.close(os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600))
        except FileExistsError:
            continue
        return path
    raise OSError(f"could not claim a file for this report in {directory}")


def spool(
    report: Report,
    *,
    path: Path | None = None,
    receipt: Receipt | None = None,
    error: str | None = None,
) -> Path:
    """Write, or update, the local copy of a report.

    Pass no `path` for the pre-send write, which claims one; pass the path it
    returned to update that same file afterwards with a receipt or an error.

    There is no confirmation step before a report leaves the machine, so this
    is the owner's only copy of what they typed if the relay is unreachable —
    written before the network call, not after it succeeds.
    """
    if path is None:
        path = allocate_spool_path(report)
    payload: dict[str, object] = {"report": report.model_dump(mode="json")}
    if receipt is not None:
        payload["receipt"] = receipt.model_dump(mode="json")
    if error is not None:
        payload["error"] = error
    path.write_text(
        json.dumps(payload, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    path.chmod(0o600)
    _prune_spool()
    return path


def _prune_spool() -> None:
    files = sorted(spool_dir().glob("*.json"))
    excess = len(files) - SPOOL_KEEP
    if excess > 0:
        for stale in files[:excess]:
            stale.unlink(missing_ok=True)


def _error_detail(body: bytes) -> str:
    text = body.decode("utf-8", errors="replace")
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        parsed = None
    if isinstance(parsed, dict):
        message = parsed.get("error")
        if isinstance(message, str):
            return message[:300]
    return text.strip()[:300] or "no details given"


def _relay_error(error: urllib.error.HTTPError) -> Exception:
    # HTTPError.read() is single-use and returns b"" once the response is
    # closed, so this must run before anything else touches the exception.
    detail = _error_detail(error.read())
    if error.code == 429:
        return OSError(
            "too many feedback reports from this machine; wait a minute and try again"
        )
    if error.code >= 500:
        return OSError(
            f"the feedback service is unavailable ({error.code}); try again later"
        )
    return ValueError(f"the feedback service rejected the report: {detail}")


def submit(report: Report, *, url: str | None = None) -> Receipt:
    """POST one report to the relay and return what it filed.

    urllib.error.HTTPError is itself an OSError, so an un-rewritten one would
    still be caught by lore/cli.py's error handling but print something
    useless like "HTTP Error 400: Bad Request" — it is rewritten here into a
    ValueError (relay rejected the input) or OSError (relay/network trouble)
    with an actual explanation.
    """
    request = urllib.request.Request(
        url or relay_url(),
        # ensure_ascii=False so non-ASCII text crosses as UTF-8 (lore/mcp.py's
        # convention for owner text crossing to a buyer) rather than as \uXXXX
        # escapes, which inflate a valid CJK description sixfold and would
        # push it past the relay's body cap; compact separators are the wire
        # convention from lore/mcp.py's JSON-RPC frames.
        data=json.dumps(
            report.model_dump(mode="json"),
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        raise _relay_error(error) from error
    except urllib.error.URLError as error:
        raise OSError(
            "could not reach the feedback service; check your connection"
        ) from error
    except TimeoutError as error:
        raise OSError("the feedback service timed out; try again later") from error
    try:
        return Receipt.model_validate(payload)
    except ValidationError as error:
        raise ValueError(
            "the feedback service returned an unreadable response"
        ) from error


def report_feedback(
    *, title: str, email: str | None, description: str, source: Source = "cli"
) -> Receipt:
    """Validate, spool, send, and record one feedback report.

    The single entry point both surfaces call — see the module docstring.
    """
    report = build(title=title, email=email, description=description, source=source)
    path = spool(report)
    try:
        receipt = submit(report)
    except OSError as error:
        spool(report, path=path, error=str(error))
        raise OSError(f"{error}. Your report is saved at {path}") from error
    except ValueError as error:
        spool(report, path=path, error=str(error))
        raise
    spool(report, path=path, receipt=receipt)
    return receipt
