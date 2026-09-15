"""List a store on the public Lore marketplace (APP-119).

The marketplace is one file in a public git repo, `marketplace.json` in
dipakkrishnan/lore-marketplace, with one entry per seller. An entry in `main`
is the listing; an open pull request is the pending state. Owners never hold
a GitHub credential, so the same relay Worker that files feedback
(`feedback-relay/`) opens the pull request on their behalf and reports which
state a node is in. Both `lore marketplace` and the Desktop app's Settings
card go through this module; the shared field limits live in
`contracts/marketplace_listing.json`, which the relay asserts too.

Every field the relay puts in an entry comes from the node's own `discover`,
fetched by the relay, so nothing the owner's machine sends can put more in
the public list than the store already shows.
"""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Literal

from pydantic import BaseModel, ConfigDict, ValidationError, field_validator

from . import blueprint, feedback
from .store import Store
from .ui import CONTROL_CHARACTERS

LISTING_VERSION: Literal[1] = 1
LISTING_ENV = "LORE_LISTING_URL"
# The relay serves both routes; the listing one sits beside /report.
LISTING_PATH = "/listing"
REGISTRY = "dipakkrishnan/lore-marketplace"
MAX_NAME = 80
MAX_BODY_BYTES = 16_384
NODE_RE = re.compile(r"^https://[^/\s]+/mcp$")
SECRET_RE = re.compile(r"^[0-9a-f]{64}$")
SECRET_SETTING = "listing_secret"
NODE_SETTING = "node_url"
TIMEOUT_SECONDS = 20.0

Action = Literal["list", "delist"]
State = Literal["none", "pending", "listed"]


class Listing(BaseModel):
    """One request as it crosses the wire to the relay."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    listing_version: Literal[1] = LISTING_VERSION
    action: Action
    node: str
    name: str | None = None
    secret: str | None = None

    @field_validator("node")
    @classmethod
    def _node(cls, value: str) -> str:
        if not NODE_RE.match(value):
            raise ValueError("the store address must be https and end in /mcp")
        return value

    @field_validator("name")
    @classmethod
    def _name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        cleaned = value.translate(CONTROL_CHARACTERS).strip()
        if not cleaned:
            raise ValueError("a display name is needed")
        if len(cleaned) > MAX_NAME:
            raise ValueError(f"the display name is over {MAX_NAME} characters")
        return cleaned

    @field_validator("secret")
    @classmethod
    def _secret(cls, value: str | None) -> str | None:
        if value is not None and not SECRET_RE.match(value):
            raise ValueError("the listing secret is malformed")
        return value


class Receipt(BaseModel):
    """What the relay says about a node after a request or a status check."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    ok: bool = True
    state: State
    # Which change a pending pull request carries, so a removal in review
    # reads differently from a listing in review.
    action: Action | None = None
    pull_url: str | None = None
    pull_number: int | None = None
    secret: str | None = None

    @field_validator("secret")
    @classmethod
    def _secret(cls, value: str | None) -> str | None:
        if value is not None and not SECRET_RE.match(value):
            raise ValueError("the listing secret is malformed")
        return value


def listing_url() -> str:
    """The relay's listing endpoint, derived from the feedback relay address so
    one pinned address turns both features on."""
    override = os.environ.get(LISTING_ENV)
    if override:
        return override
    base = feedback.relay_url()
    return base.removesuffix("/report") + LISTING_PATH


def available() -> bool:
    """Whether this build can talk to the marketplace at all."""
    try:
        listing_url()
    except ValueError:
        return False
    return True


def node_url() -> str:
    with Store() as store:
        value = store.setting(NODE_SETTING, None)
    if not isinstance(value, str) or not value:
        raise ValueError("open your store before listing it")
    return value


def default_name() -> str | None:
    """The name the owner gave during setup, if any."""
    saved = blueprint.load_blueprint()
    name = saved.get("name") if saved else None
    return name if isinstance(name, str) and name.strip() else None


def _summarize(error: ValidationError) -> str:
    first = error.errors()[0]
    message = first["msg"]
    prefix = "Value error, "
    return message[len(prefix) :] if message.startswith(prefix) else message


def build(action: Action, *, name: str | None = None) -> Listing:
    """Assemble one request from local state and owner input."""
    node = node_url()
    secret = None
    if action == "delist":
        with Store() as store:
            saved = store.setting(SECRET_SETTING, None)
        if not isinstance(saved, str):
            raise ValueError("this store was not listed from this Mac")
        secret = saved
    else:
        name = name or default_name()
        if not name:
            raise ValueError("a display name is needed; pass --name")
    try:
        return Listing(action=action, node=node, name=name, secret=secret)
    except ValidationError as error:
        raise ValueError(_summarize(error)) from error


def _relay_error(error: urllib.error.HTTPError) -> Exception:
    body = error.read()
    try:
        detail = json.loads(body.decode("utf-8", errors="replace")).get("error")
    except (ValueError, AttributeError):
        detail = None
    said = detail if isinstance(detail, str) and detail else f"HTTP {error.code}"
    if 400 <= error.code < 500 and error.code != 429:
        return ValueError(f"the marketplace refused the request: {said}")
    return OSError(f"the marketplace service could not finish: {said}")


def _call(request: urllib.request.Request) -> Receipt:
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            payload = json.loads(response.read().decode())
    except urllib.error.HTTPError as error:
        raise _relay_error(error) from error
    except urllib.error.URLError as error:
        raise OSError(
            "could not reach the marketplace service; check your connection"
        ) from error
    except TimeoutError as error:
        raise OSError("the marketplace service timed out; try again later") from error
    try:
        return Receipt.model_validate(payload)
    except ValidationError as error:
        raise ValueError(
            "the marketplace service returned an unreadable response"
        ) from error


def submit(listing: Listing, *, url: str | None = None) -> Receipt:
    """Send one list or delist request and keep the secret a listing returns."""
    request = urllib.request.Request(
        url or listing_url(),
        data=json.dumps(
            listing.model_dump(mode="json", exclude_none=True),
            ensure_ascii=False,
            separators=(",", ":"),
            allow_nan=False,
        ).encode("utf-8"),
        headers={
            "Accept": "application/json",
            "Content-Type": "application/json",
            "User-Agent": feedback.USER_AGENT,
        },
        method="POST",
    )
    receipt = _call(request)
    if receipt.secret:
        with Store() as store:
            store.set_setting(SECRET_SETTING, receipt.secret)
    return receipt


def status(*, url: str | None = None) -> Receipt:
    """Ask the relay whether this node is listed, pending, or neither."""
    node = node_url()
    request = urllib.request.Request(
        f"{url or listing_url()}?{urllib.parse.urlencode({'node': node})}",
        headers={"Accept": "application/json", "User-Agent": feedback.USER_AGENT},
        method="GET",
    )
    return _call(request)


def act(action: Action, *, name: str | None = None) -> Receipt:
    """List or delist this store: build, send, keep the receipt's secret."""
    return submit(build(action, name=name))
