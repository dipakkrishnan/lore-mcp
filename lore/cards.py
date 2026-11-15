"""Get paid by card (XC-039): open a seller's own Stripe account through Lore's
checkout Worker, which holds the only Stripe key. This machine never sees one;
it keeps the account id and a token proving the account is the owner's."""

from __future__ import annotations

import http.client
import json
import os
import urllib.error
import urllib.parse
import urllib.request

from . import feedback

# LORE_CHECKOUT_URL exists for tests and for a checkout Worker run locally.
CHECKOUT_ENV = "LORE_CHECKOUT_URL"
CHECKOUT_URL = "https://checkout.yourlore.dev"
TIMEOUT_SECONDS = 20
# A 200 whose body is not a whole JSON object (or, for a new account, lacks the
# account and its token) is read as a failure of the checkout, like a refusal.
UNREADABLE = "Lore's card checkout sent an answer Lore can't read; try again later"


def checkout_url() -> str:
    return os.environ.get(CHECKOUT_ENV, CHECKOUT_URL).rstrip("/")


def _call(
    path: str, method: str = "GET", form: dict[str, str] | None = None
) -> dict[str, object]:
    request = urllib.request.Request(
        f"{checkout_url()}{path}",
        method=method,
        data=urllib.parse.urlencode(form).encode() if form else None,
        headers={"Accept": "application/json", "User-Agent": feedback.USER_AGENT},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        raise OSError(
            f"Lore's card checkout refused that ({error.code}); try again later"
        ) from error
    # A connection closed before any answer (RemoteDisconnected is also an
    # HTTPException) is the checkout not answering, not an unreadable answer.
    except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
        raise OSError(
            "could not reach Lore's card checkout; check your connection"
        ) from error
    except http.client.HTTPException as error:
        # A body cut short of its Content-Length (IncompleteRead).
        raise OSError(UNREADABLE) from error
    try:
        found = json.loads(body.decode())
    except ValueError as error:  # not JSON, or not UTF-8
        raise OSError(UNREADABLE) from error
    if not isinstance(found, dict):
        raise OSError(UNREADABLE)
    return found


def open_account() -> tuple[str, str]:
    """A new Stripe account for this seller, and the token that proves it's theirs."""
    found = _call("/accounts", "POST")
    account, token = found.get("account"), found.get("token")
    if not (isinstance(account, str) and account and isinstance(token, str) and token):
        raise OSError(UNREADABLE)
    return account, token


def onboarding_url(account: str, token: str) -> str:
    """Stripe's form for this account, reached through the checkout Worker."""
    query = urllib.parse.urlencode({"account": account, "token": token})
    return f"{checkout_url()}/onboard?{query}"


def status(account: str, token: str) -> tuple[bool, bool]:
    """Whether Stripe lets the account take cards yet, and if not, whether
    Stripe is still checking (rather than waiting on the owner)."""
    query = urllib.parse.urlencode({"account": account, "token": token})
    found = _call(f"/accounts/status?{query}")
    return bool(found.get("ready")), bool(found.get("checking"))


def bind(account: str, token: str, origin: str) -> None:
    """Tie the account to this owner's store, so no other store can charge into it."""
    _call(
        "/accounts/bind",
        "POST",
        {"account": account, "token": token, "origin": origin},
    )
