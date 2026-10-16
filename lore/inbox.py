"""The owner's side of Lore's hosted inbox (XC-067, `contracts/inbox.md`): where the
owner's personal agents save what they learn, sealed to a key only this Mac holds."""

from __future__ import annotations

import json
import os
import re
from base64 import urlsafe_b64decode, urlsafe_b64encode
from functools import cached_property
from importlib.resources import files
from typing import Literal

import httpx2
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from pydantic import BaseModel

from .signin import Keychain

AgentApp = Literal["grok", "muse", "chatgpt", "claude", "other"]


class InboxError(ValueError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class Agent(BaseModel):
    id: str
    name: str
    app: AgentApp
    created_at: str
    last_saved_at: str | None = None
    saved: int = 0
    waiting: int = 0
    revoked: bool = False


class Owner(BaseModel):
    owner: str
    waiting: int = 0
    agents: list[Agent] = []


class Registered(BaseModel):
    owner: str
    token: str


class Minted(BaseModel):
    agent: Agent
    token: str
    mcp_url: str


class Rotated(BaseModel):
    token: str


class Sealed(BaseModel):
    id: str
    agent: str
    state: Literal["waiting", "forgotten"]
    sealed: str
    saved_at: str


class Waiting(BaseModel):
    items: list[Sealed]


class Save(BaseModel):
    title: str
    content: str
    topic: str | None = None
    kind: str | None = None
    key: str | None = None
    occurred_at: str | None = None


class Forget(BaseModel):
    key: str
    forget: Literal[True]


class Opened(BaseModel):
    id: str
    saved_at: str
    payload: Forget | Save

    @property
    def key(self) -> str:
        return self.payload.key or self.id


class Identity(BaseModel):
    owner: str
    token: str
    private_key: str


class Credentials(Keychain):
    """The owner token and private key, in the Keychain beside every other sign-in."""

    kinds = ("owner",)

    def load(self) -> Identity | None:
        return self._load("owner", Identity)

    def save(self, identity: Identity) -> None:
        self._save("owner", identity)


class Inbox:
    default = "https://inbox.yourlore.dev"
    info = b"lore-inbox-v1"
    timeout = 20.0

    def __init__(self) -> None:
        self.base = os.environ.get("LORE_INBOX_URL", self.default).rstrip("/")
        self.credentials = Credentials(self.base)

    @property
    def mcp_url(self) -> str:
        return f"{self.base}/mcp"

    @cached_property
    def identity(self) -> Identity | None:
        return self.credentials.load()

    def register(self) -> Identity:
        """This Mac's owner identity, made on first use only."""
        if self.identity:
            return self.identity
        private = X25519PrivateKey.generate()
        public = _encode(private.public_key().public_bytes_raw())
        made = Registered.model_validate(
            self._send("POST", "/owners", {"public_key": public}, owner=False)
        )
        identity = Identity(
            owner=made.owner,
            token=made.token,
            private_key=_encode(private.private_bytes_raw()),
        )
        self.credentials.save(identity)
        self.identity = identity
        return identity

    def me(self) -> Owner:
        return Owner.model_validate(self._send("GET", "/owners/me"))

    def mint(self, name: str, app: str) -> Minted:
        return Minted.model_validate(
            self._send("POST", "/owners/me/agents", {"name": name, "app": app})
        )

    def rotate(self, agent: str) -> str:
        return Rotated.model_validate(
            self._send("POST", f"/owners/me/agents/{agent}/key")
        ).token

    def revoke(self, agent: str) -> None:
        self._send("DELETE", f"/owners/me/agents/{agent}")

    def items(self, agent: str, limit: int = 200) -> list[Sealed]:
        return Waiting.model_validate(
            self._send(
                "GET", "/owners/me/items", params={"agent": agent, "limit": limit}
            )
        ).items

    def open(self, item: Sealed) -> Opened:
        identity = self._identity()
        plain = self.unseal(identity.private_key, item.id, item.sealed)
        try:
            return Opened.model_validate(
                {"id": item.id, "saved_at": item.saved_at, "payload": json.loads(plain)}
            )
        except ValueError:
            raise InboxError(f"item {item.id} isn't a save Lore understands") from None

    def received(self, ids: list[str]) -> None:
        self._send("POST", "/owners/me/items/received", {"ids": ids})

    def erase(self) -> None:
        self._send("DELETE", "/owners/me")
        self.credentials.forget()
        self.identity = None

    @classmethod
    def unseal(cls, private_key: str, item_id: str, sealed: str) -> bytes:
        try:
            raw = _decode(sealed)
            ephemeral, nonce, box = raw[:32], raw[32:44], raw[44:]
            private = X25519PrivateKey.from_private_bytes(_decode(private_key))
            shared = private.exchange(X25519PublicKey.from_public_bytes(ephemeral))
            salt = ephemeral + private.public_key().public_bytes_raw()
            key = HKDF(SHA256(), 32, salt=salt, info=cls.info).derive(shared)
            return AESGCM(key).decrypt(nonce, box, item_id.encode())
        except (ValueError, InvalidTag):
            raise InboxError(
                f"item {item_id} doesn't open with this Mac's key"
            ) from None

    def _identity(self) -> Identity:
        if not self.identity:
            raise InboxError("No personal agent is connected to Lore yet.", 401)
        return self.identity

    def _send(
        self,
        method: str,
        path: str,
        body: object = None,
        *,
        params: dict[str, str | int] | None = None,
        owner: bool = True,
    ) -> object:
        headers = {"Authorization": f"Bearer {self._identity().token}"} if owner else {}
        try:
            response = httpx2.request(
                method,
                self.base + path,
                json=body,
                params=params,
                headers=headers,
                timeout=self.timeout,
            )
        except httpx2.HTTPError:
            raise InboxError("Lore's inbox can't be reached right now.") from None
        if response.status_code == 401:
            raise InboxError("Lore's inbox no longer knows this Mac.", 401)
        if response.is_error:
            try:
                said = str(response.json()["error"])
            except (ValueError, KeyError, TypeError):
                said = f"Lore's inbox answered {response.status_code}"
            raise InboxError(said, response.status_code)
        return response.json() if response.content else None


class SetupPrompt:
    """The paste block an owner gives a personal agent: the lore-store skill's body,
    with that agent's name and connection filled in."""

    skill = files("lore") / "store_skill.md"
    fields = re.compile(r"\{(name|mcp_url|header)\}")

    def __init__(self, name: str, mcp_url: str, token: str) -> None:
        self.values = {
            "name": name,
            "mcp_url": mcp_url,
            "header": f"Authorization: Bearer {token}",
        }

    @property
    def header(self) -> str:
        return self.values["header"]

    def render(self) -> str:
        body = self.skill.read_text(encoding="utf-8").split("---", 2)[2].strip()
        return self.fields.sub(lambda found: self.values[found[1]], body)


def _encode(raw: bytes) -> str:
    return urlsafe_b64encode(raw).rstrip(b"=").decode()


def _decode(text: str) -> bytes:
    return urlsafe_b64decode(text + "=" * (-len(text) % 4))
