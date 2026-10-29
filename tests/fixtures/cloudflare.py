"""A stand-in for the few Cloudflare API endpoints Lore calls (XC-087).

Shaped after Cloudflare's v4 envelope (`success`, `errors[{code, message}]`,
`result`, `result_info`) and the codes wrangler itself checks: 10007 for an
account with no workers.dev address, 10031 for a name someone else has.
Patch it over `lore.cloudflare.request.urlopen`; nothing reaches the network.
"""

from __future__ import annotations

import json
from email.message import Message
from io import BytesIO
from typing import Any
from urllib.error import HTTPError

ADA = {"id": "0123456789abcdef0123456789abcdef", "name": "Ada's Account"}
LAB = {"id": "fedcba9876543210fedcba9876543210", "name": "Lab"}


class _Answer(BytesIO):
    status = 200

    def __enter__(self) -> _Answer:
        return self

    def __exit__(self, *exc: object) -> None:
        self.close()


class FakeCloudflare:
    """One account's worth of Cloudflare: its memberships and its workers.dev address."""

    def __init__(
        self,
        accounts: list[dict[str, str]] | None = None,
        *,
        subdomain: str | None = "ada",
        taken: tuple[str, ...] = (),
        unverified: bool = False,
    ) -> None:
        self.accounts = [ADA] if accounts is None else accounts
        self.subdomain = subdomain
        self.taken = set(taken)
        self.unverified = unverified
        self.calls: list[tuple[str, str, object]] = []
        self.tokens: set[str] = set()

    def __call__(self, call: Any, timeout: float | None = None) -> _Answer:
        path = call.full_url.removeprefix("https://api.cloudflare.com/client/v4")
        body = json.loads(call.data) if call.data else None
        self.calls.append((call.get_method(), path, body))
        self.tokens.add(call.get_header("Authorization"))
        if self.unverified:
            return self._refuse(
                call, 403, 10034, "workers.api.error.email_verification_required"
            )
        if path.startswith("/accounts?"):
            return self._answer(self.accounts, {"page": 1, "total_pages": 1})
        if path.endswith("/workers/subdomain") and call.get_method() == "GET":
            if self.subdomain is None:
                return self._refuse(
                    call,
                    404,
                    10007,
                    "This account doesn't have a workers.dev subdomain.",
                )
            return self._answer({"subdomain": self.subdomain})
        if path.endswith("/workers/subdomain") and call.get_method() == "PUT":
            if body["subdomain"] in self.taken:
                return self._refuse(call, 409, 10031, "Subdomain is unavailable.")
            self.subdomain = body["subdomain"]
            return self._answer({"subdomain": self.subdomain})
        raise AssertionError(f"no stand-in for {call.get_method()} {path}")

    def made(self) -> list[str]:
        return [body["subdomain"] for method, _, body in self.calls if method == "PUT"]  # type: ignore[index]

    @staticmethod
    def _answer(result: object, info: dict[str, int] | None = None) -> _Answer:
        envelope: dict[str, object] = {
            "success": True,
            "errors": [],
            "messages": [],
            "result": result,
        }
        if info:
            envelope["result_info"] = info
        return _Answer(json.dumps(envelope).encode())

    @staticmethod
    def _refuse(call: Any, status: int, code: int, message: str) -> _Answer:
        body = {
            "success": False,
            "errors": [{"code": code, "message": message}],
            "messages": [],
            "result": None,
        }
        raise HTTPError(
            call.full_url,
            status,
            message,
            Message(),
            BytesIO(json.dumps(body).encode()),
        )
