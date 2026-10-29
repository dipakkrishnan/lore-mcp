"""The owner's store as Lore hosts it at yourlore.dev (XC-088, `contracts/hosted-inbox.md`).

Lore hosts it and the owner holds the keys. This Mac signs every change to the store
with an Ed25519 key that never leaves its Keychain, and the store seals agents' saves
to the inbox key beside it, so Lore relays what it can't read or change. An owner who
deploys their own store on Cloudflare uses that one instead."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import time
import urllib.error
import urllib.request
from base64 import urlsafe_b64decode, urlsafe_b64encode
from typing import cast

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from keyring.errors import KeyringError
from pydantic import BaseModel

from . import deploy
from .signin import Keychain
from .store import Store

DOMAIN = os.environ.get("LORE_HOSTED_DOMAIN", "yourlore.dev")
SETTING = "hosted_store"
ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"
TIMEOUT_SECONDS = 20

Rows = list[list[dict[str, object]]]


class HostedError(OSError):
    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class OwnerKey(BaseModel):
    private_key: str

    @property
    def signer(self) -> Ed25519PrivateKey:
        return Ed25519PrivateKey.from_private_bytes(_decode(self.private_key))

    @property
    def public_key(self) -> str:
        return _encode(self.signer.public_key().public_bytes_raw())


class Credentials(Keychain):
    """The store's signing key, in the Keychain beside the inbox keys: nothing on disk."""

    kinds = ("owner",)

    def __init__(self) -> None:
        super().__init__("hosted")

    def load(self) -> OwnerKey | None:
        return self._load("owner", OwnerKey)

    def save(self, key: OwnerKey) -> None:
        self._save("owner", key)


class Hosted:
    def __init__(self, store_id: str, credentials: Credentials | None = None) -> None:
        self.store_id = store_id
        self.credentials = credentials or Credentials()

    @classmethod
    def of(cls, store: Store) -> Hosted | None:
        """The store Lore hosts for this owner's agents. Once claimed it stays their
        inbox, even after they open a store of their own on Cloudflare: the agents
        already save there, until a move (XC-089) carries them over."""
        claimed = store.setting(SETTING, None)
        return cls(claimed) if isinstance(claimed, str) else None

    @classmethod
    def claim(cls, store: Store, credentials: Credentials | None = None) -> Hosted:
        """This owner's hosted store, claimed with this Mac's key. Claiming again is
        safe: the same key gets the same store back."""
        claimed = store.setting(SETTING, None)
        hosted = cls(claimed if isinstance(claimed, str) else _new_id(), credentials)
        key = hosted._key()
        try:
            hosted._send(
                "/claim", {"key": key.public_key}, "Lore couldn't put your store online"
            )
        except HostedError as error:
            # Another key holds that address: this Mac lost the key it claimed with, so
            # the store it had can't be changed any more. It starts a new one.
            if error.status != 409:
                raise
            hosted = cls(_new_id(), credentials)
            hosted._send(
                "/claim", {"key": key.public_key}, "Lore couldn't put your store online"
            )
        store.set_setting(SETTING, hosted.store_id)
        return hosted

    @property
    def origin(self) -> str:
        return f"https://{self.store_id}.{DOMAIN}"

    @property
    def agent_url(self) -> str:
        return f"{self.origin}/agent"

    def sql(self, query: str, fail: str) -> Rows:
        """Every statement's rows, all or none, as `wrangler d1 execute` gives them."""
        answer = self._send("/owner/sql", {"sql": query}, fail)
        return cast(Rows, answer["results"])

    def _key(self) -> OwnerKey:
        try:
            key = self.credentials.load()
            if key is None:
                raw = Ed25519PrivateKey.generate().private_bytes_raw()
                key = OwnerKey(private_key=_encode(raw))
                self.credentials.save(key)
        except KeyringError as error:
            raise HostedError(f"Lore couldn't use the Keychain: {error}") from None
        return key

    def _send(self, path: str, body: dict[str, object], fail: str) -> dict[str, object]:
        data = json.dumps(body).encode()
        moment, nonce = str(int(time.time() * 1000)), secrets.token_urlsafe(16)
        message = signed(f"{self.store_id}.{DOMAIN}", path, moment, nonce, data)
        request = urllib.request.Request(
            f"{self.origin}{path}",
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Lore/0.1",
                "Lore-Time": moment,
                "Lore-Nonce": nonce,
                "Lore-Signature": _encode(self._key().signer.sign(message)),
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return cast(dict[str, object], json.loads(response.read()))
        except urllib.error.HTTPError as error:
            raise HostedError(f"{fail}: {_said(error)}", error.code) from None
        except (urllib.error.URLError, TimeoutError) as error:
            reason = getattr(error, "reason", error)
            raise HostedError(f"{fail}: {DOMAIN} didn't answer ({reason})") from None


def agent_address(store: Store) -> str | None:
    """Where the owner's agents save: the store Lore hosts once claimed, else their
    own store's `/agent`, else nowhere yet."""
    claimed = Hosted.of(store)
    if claimed:
        return claimed.agent_url
    node = store.setting("node_url", None)
    if isinstance(node, str) and node:
        return node.rstrip("/").removesuffix("/mcp") + "/agent"
    return None


def run(query: str, fail: str) -> Rows:
    """Every statement's rows from the owner's inbox: the store Lore hosts once
    claimed, else their own on Cloudflare."""
    with Store() as store:
        hosted = Hosted.of(store)
    return hosted.sql(query, fail) if hosted else deploy._read_all(query, fail)


def signed(host: str, path: str, moment: str, nonce: str, data: bytes) -> bytes:
    """What the Mac signs: the request, bound to the store's address, a moment and a
    nonce, so it can't be sent to another store or sent twice."""
    digest = hashlib.sha256(data).hexdigest()
    return "\n".join(
        ("lore-owner-v1", "POST", host, path, moment, nonce, digest)
    ).encode()


def _said(error: urllib.error.HTTPError) -> str:
    try:
        return str(json.loads(error.read())["error"])
    except (ValueError, KeyError, TypeError):
        return f"the store answered {error.code}"


def _new_id() -> str:
    return "".join(secrets.choice(ALPHABET) for _ in range(12))


def _encode(raw: bytes) -> str:
    return urlsafe_b64encode(raw).rstrip(b"=").decode()


def _decode(text: str) -> bytes:
    return urlsafe_b64decode(text + "=" * (-len(text) % 4))
