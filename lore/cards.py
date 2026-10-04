"""Get paid by card (XC-039): open a seller's own Stripe account through Lore's
checkout Worker, which holds the only Stripe key. This machine never sees one;
it keeps the account id and a token proving the account is the owner's."""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request

# LORE_CHECKOUT_URL exists for tests and for a checkout Worker run locally.
CHECKOUT_ENV = "LORE_CHECKOUT_URL"
CHECKOUT_URL = "https://checkout.yourlore.dev"
TIMEOUT_SECONDS = 20


def checkout_url() -> str:
    return os.environ.get(CHECKOUT_ENV, CHECKOUT_URL).rstrip("/")


def _call(path: str, method: str = "GET") -> dict[str, object]:
    request = urllib.request.Request(
        f"{checkout_url()}{path}",
        method=method,
        headers={"Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            found: dict[str, object] = json.loads(response.read().decode())
            return found
    except urllib.error.HTTPError as error:
        raise OSError(
            f"Lore's card checkout refused that ({error.code}); try again later"
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise OSError(
            "could not reach Lore's card checkout; check your connection"
        ) from error


def open_account() -> tuple[str, str]:
    """A new Stripe account for this seller, and the token that proves it's theirs."""
    found = _call("/accounts", "POST")
    return str(found["account"]), str(found["token"])


def onboarding_url(account: str, token: str) -> str:
    """Stripe's form for this account, reached through the checkout Worker."""
    query = urllib.parse.urlencode({"account": account, "token": token})
    return f"{checkout_url()}/onboard?{query}"


def ready(account: str, token: str) -> bool:
    """Whether Stripe lets the account take card payments yet."""
    query = urllib.parse.urlencode({"account": account, "token": token})
    return bool(_call(f"/accounts/status?{query}").get("ready"))
