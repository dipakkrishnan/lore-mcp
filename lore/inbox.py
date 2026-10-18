"""The owner's side of the agent inbox (XC-067, `contracts/inbox.md`): the owner's
personal agents save into the owner's own node, sealed to a key only this Mac holds,
and the Mac collects through wrangler the way it reads sales."""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
from base64 import urlsafe_b64decode, urlsafe_b64encode
from datetime import datetime, timezone
from functools import cached_property
from importlib.resources import files
from typing import Annotated, Literal

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.asymmetric.x25519 import (
    X25519PrivateKey,
    X25519PublicKey,
)
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.hashes import SHA256
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from keyring.errors import KeyringError
from pydantic import BaseModel, StringConstraints, TypeAdapter, ValidationError

from . import deploy
from .signin import Keychain

AgentApp = Literal["grok", "muse", "chatgpt", "claude", "other"]
Name = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)
]

SCHEMA = """CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, name TEXT NOT NULL,
app TEXT NOT NULL, token_hash TEXT NOT NULL, created_at TEXT NOT NULL, revoked_at TEXT,
last_saved_at TEXT, saved INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS inbox (id TEXT PRIMARY KEY, agent TEXT NOT NULL,
key_hash TEXT NOT NULL,
state TEXT NOT NULL CHECK (state IN ('waiting','forgotten','received')),
sealed TEXT, saved_at TEXT NOT NULL, received_at TEXT);
CREATE TABLE IF NOT EXISTS inbox_windows (agent TEXT NOT NULL, span TEXT NOT NULL,
started TEXT NOT NULL, used INTEGER NOT NULL, PRIMARY KEY (agent, span));
CREATE TABLE IF NOT EXISTS node_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
"""
# A received forget keeps its state, so what is still owed is what still has a payload.
OWED = "state IN ('waiting','forgotten') AND sealed IS NOT NULL"
AGENTS = (
    "SELECT a.id, a.name, a.app, a.created_at, a.last_saved_at, a.saved, "
    "a.revoked_at IS NOT NULL AS revoked, (SELECT count(*) FROM inbox i "
    f"WHERE i.agent = a.id AND {OWED}) AS waiting FROM agents a"
)


class InboxError(ValueError):
    pass


class Agent(BaseModel):
    id: str
    name: str
    app: AgentApp
    created_at: str
    last_saved_at: str | None = None
    saved: int = 0
    waiting: int = 0
    revoked: bool = False


class Minted(BaseModel):
    agent: Agent
    token: str


class Sealed(BaseModel):
    id: str
    agent: str
    state: Literal["waiting", "forgotten"]
    sealed: str
    saved_at: str


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


class Keys(BaseModel):
    """The owner's half of the inbox: what opens a save, and what hashes its key."""

    private_key: str
    salt: str

    @property
    def public_key(self) -> str:
        private = X25519PrivateKey.from_private_bytes(_decode(self.private_key))
        return _encode(private.public_key().public_bytes_raw())


class Credentials(Keychain):
    """The inbox keys, in the Keychain beside every other sign-in: nothing on disk."""

    kinds = ("keys",)

    def __init__(self) -> None:
        super().__init__("inbox")

    def load(self) -> Keys | None:
        return self._load("keys", Keys)

    def save(self, keys: Keys) -> None:
        self._save("keys", keys)


class Inbox:
    info = b"lore-inbox-v1"

    def __init__(self) -> None:
        self.credentials = Credentials()

    @cached_property
    def keys(self) -> Keys | None:
        try:
            return self.credentials.load()
        except KeyringError:
            # No keyring at all, as on a server: no agent was ever connected here.
            return None

    def settings(self) -> dict[str, str]:
        """What every push writes into `node_settings`, so the node seals to this Mac."""
        if not self.keys:
            return {}
        return {"inbox_public_key": self.keys.public_key, "inbox_salt": self.keys.salt}

    def mint(self, name: str, app: str) -> Minted:
        """A new agent and its key, of which the node learns only the hash. The first
        mint also makes the owner's keys and the node's tables."""
        try:
            name = TypeAdapter(Name).validate_python(name)
            app = TypeAdapter(AgentApp).validate_python(app)
        except ValidationError:
            raise InboxError(
                "An agent's name is 1-40 characters, and its app one of "
                "grok, chatgpt, claude or other."
            ) from None
        # APP-217: Muse has no way to take a link yet. Agents already connected as Muse
        # keep listing, re-keying and disconnecting; only a new one is refused.
        if app == "muse":
            raise InboxError("Muse can't connect yet.")
        if not self.keys:
            private = X25519PrivateKey.generate()
            keys = Keys(
                private_key=_encode(private.private_bytes_raw()),
                salt=_encode(os.urandom(32)),
            )
            self.credentials.save(keys)
            self.keys = keys
        agent, token, hashed = self._token()
        settings = "".join(
            "INSERT OR REPLACE INTO node_settings(key,value) "
            f"VALUES ({_quote(key)},{_quote(value)});\n"
            for key, value in self.settings().items()
        )
        rows = self._run(
            f"{SCHEMA}{settings}"
            "INSERT INTO agents(id,name,app,token_hash,created_at) VALUES "
            f"({_quote(agent)},{_quote(name)},{_quote(app)},{_quote(hashed)},"
            f"{_quote(_now())});\n"
            f"{AGENTS} WHERE a.id = {_quote(agent)};",
            "connecting the agent failed",
        )
        return Minted(agent=Agent.model_validate(rows[0]), token=token)

    def rotate(self, agent: str) -> Minted:
        """A new key for the same agent, so its memories keep their provenance."""
        _, token, hashed = self._token(agent)
        rows = self._run(
            f"UPDATE agents SET token_hash = {_quote(hashed)} "
            f"WHERE id = {_quote(agent)} AND revoked_at IS NULL;\n"
            f"{AGENTS} WHERE a.id = {_quote(agent)} AND a.revoked_at IS NULL;",
            "making a new key failed",
        )
        if not rows:
            raise InboxError(f"no connected agent {agent}")
        return Minted(agent=Agent.model_validate(rows[0]), token=token)

    def revoke(self, agent: str) -> None:
        self._run(
            f"UPDATE agents SET revoked_at = coalesce(revoked_at, {_quote(_now())}) "
            f"WHERE id = {_quote(agent)};",
            "disconnecting the agent failed",
        )

    def agents(self) -> list[Agent]:
        return [
            Agent.model_validate(row)
            for row in self._run(f"{AGENTS};", "reading your agents failed")
        ]

    def waiting(self) -> dict[str, int]:
        rows = self._run(
            f"SELECT agent, count(*) AS waiting FROM inbox WHERE {OWED} GROUP BY agent;",
            "checking for saves failed",
        )
        return {str(row["agent"]): int(str(row["waiting"])) for row in rows}

    def items(self, agent: str) -> list[Sealed]:
        return [
            Sealed.model_validate(row)
            for row in self._run(
                "SELECT id, agent, state, sealed, saved_at FROM inbox "
                f"WHERE agent = {_quote(agent)} AND {OWED} "
                "ORDER BY saved_at LIMIT 200;",
                "collecting saves failed",
            )
        ]

    def open(self, item: Sealed) -> Opened:
        if not self.keys:
            raise InboxError("This Mac has no key to open saves with.")
        plain = self.unseal(self.keys.private_key, item.id, item.sealed)
        try:
            return Opened.model_validate(
                {"id": item.id, "saved_at": item.saved_at, "payload": json.loads(plain)}
            )
        except ValueError:
            raise InboxError(f"item {item.id} isn't a save Lore understands") from None

    def received(self, items: list[Opened]) -> None:
        """Drop the payloads the library now holds. Only the version collected goes:
        a save made since then waits for the next collection."""
        now = _quote(_now())
        self._run(
            "".join(
                "UPDATE inbox SET state = CASE state WHEN 'forgotten' THEN 'forgotten' "
                f"ELSE 'received' END, sealed = NULL, received_at = {now} "
                f"WHERE id = {_quote(item.id)} AND saved_at = {_quote(item.saved_at)};\n"
                for item in items
            ),
            "confirming saves failed",
        )

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

    @staticmethod
    def _token(agent: str | None = None) -> tuple[str, str, str]:
        agent = agent or secrets.token_hex(8)
        secret = secrets.token_urlsafe(32)
        hashed = hashlib.sha256(secret.encode()).hexdigest()
        return agent, f"lore_agent_{agent}_{secret}", hashed

    @staticmethod
    def _run(sql: str, fail: str) -> list[dict[str, object]]:
        try:
            return deploy._read(sql, fail)
        except (OSError, ValueError) as error:
            raise InboxError(str(error)) from None


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


def _now() -> str:
    moment = datetime.now(timezone.utc).isoformat(timespec="milliseconds")
    return moment.replace("+00:00", "Z")


def _quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _encode(raw: bytes) -> str:
    return urlsafe_b64encode(raw).rstrip(b"=").decode()


def _decode(text: str) -> bytes:
    return urlsafe_b64decode(text + "=" * (-len(text) % 4))
