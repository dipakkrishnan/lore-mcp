"""The owner's Cloudflare account, read and readied through Cloudflare's API (XC-087).

A deploy runs wrangler with no one at its prompts, so anything wrangler would
ask about is settled here first, with wrangler's own sign-in: which account the
store goes on, and the account's workers.dev address, made if it has none.
"""

from __future__ import annotations

import json
import re
import secrets
import time
from urllib import request
from urllib.error import HTTPError

from pydantic import BaseModel, TypeAdapter

API = "https://api.cloudflare.com/client/v4"
TIMEOUT_S = 20
# Cloudflare's codes: an account with no workers.dev address yet, a name someone
# else has, and an email not verified yet.
NO_SUBDOMAIN = 10007
TAKEN = 10031
UNVERIFIED_CODE = 10034
UNVERIFIED_WORDS = "email_verification_required"


class Account(BaseModel):
    id: str
    name: str


ACCOUNTS = TypeAdapter(list[Account])


class CloudflareError(OSError):
    """A request Cloudflare refused, with its own codes and words."""

    def __init__(self, errors: list[dict[str, object]], status: int) -> None:
        self.codes = {error.get("code") for error in errors}
        words = "; ".join(str(error.get("message", "")) for error in errors)
        super().__init__(f"Cloudflare refused the request ({status}): {words}")

    @property
    def unverified(self) -> bool:
        """Whether Cloudflare wants the account's email verified first."""
        return UNVERIFIED_CODE in self.codes or UNVERIFIED_WORDS in str(self)


class Cloudflare:
    """Cloudflare's API as the signed-in owner, through the token wrangler keeps."""

    def __init__(self, token: str) -> None:
        self.token = token

    def _call(self, method: str, path: str, body: object = None) -> dict[str, object]:
        call = request.Request(
            f"{API}{path}",
            method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={
                "Authorization": f"Bearer {self.token}",
                "Content-Type": "application/json",
            },
        )
        try:
            with request.urlopen(call, timeout=TIMEOUT_S) as response:
                answer = json.load(response)
            status = response.status
        except HTTPError as error:
            status = error.code
            try:
                answer = json.load(error)
            except ValueError:
                answer = {}
        if not isinstance(answer, dict) or not answer.get("success"):
            errors = answer.get("errors") if isinstance(answer, dict) else None
            raise CloudflareError(errors if isinstance(errors, list) else [], status)
        return answer

    def accounts(self) -> list[Account]:
        """Every account this sign-in can deploy to."""
        found: list[Account] = []
        page = 1
        while True:
            answer = self._call("GET", f"/accounts?per_page=50&page={page}")
            found += ACCOUNTS.validate_python(answer["result"])
            info = answer.get("result_info")
            pages = info.get("total_pages", 1) if isinstance(info, dict) else 1
            if not isinstance(pages, int) or page >= pages:
                return found
            page += 1

    def subdomain(self, account: str) -> str | None:
        """The account's workers.dev address, or none if it has never had one."""
        try:
            answer = self._call("GET", f"/accounts/{account}/workers/subdomain")
        except CloudflareError as error:
            if NO_SUBDOMAIN in error.codes:
                return None
            raise
        result = answer.get("result")
        name = result.get("subdomain") if isinstance(result, dict) else None
        return name if isinstance(name, str) and name else None

    def register(self, account: str, wanted: str, *, waits: int = 10) -> str:
        """Give the account a workers.dev address near `wanted`, then wait until
        Cloudflare reports it. A name someone else has gets a number after it."""
        tries = [
            wanted,
            *(f"{wanted}-{n}" for n in range(2, 5)),
            f"{wanted}-{secrets.token_hex(3)}",
        ]
        for name in tries:
            try:
                self._call(
                    "PUT", f"/accounts/{account}/workers/subdomain", {"subdomain": name}
                )
            except CloudflareError as error:
                if TAKEN in error.codes:
                    continue
                raise
            for _ in range(waits):
                if self.subdomain(account) == name:
                    return name
                time.sleep(2)
            return name
        raise CloudflareError(
            [{"code": TAKEN, "message": "every name tried was taken"}], 409
        )


def subdomain_name(owner: str) -> str:
    """A workers.dev name from the owner's own name, as wrangler shapes one; a
    random one when there is no name, so the owner is never asked for it."""
    slug = re.sub(r"[^a-z0-9-]+", "-", owner.lower()).strip("-")[:50].strip("-")
    return f"{slug}-lore" if slug else f"lore-{secrets.token_hex(3)}"
