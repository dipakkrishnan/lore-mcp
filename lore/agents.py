"""The owner's personal agents (CAP-036): each one a key to the owner's own store and
a source, read like every other source and shown with what it has saved."""

from __future__ import annotations

import time

from .hosted import agent_address
from .inbox import Inbox, Minted, SetupPrompt, SignIn
from .sources import Registry, SourceError
from .store import Store

# XC-068: once the owner copies the plain address, Lore listens this long for the app to sign in.
EXPECTING = 15 * 60
# A word in the name an app signing in gives itself, the agent that makes it, and what the owner calls that agent.
APPS = (
    ("claude", "claude", "Claude"),
    ("chatgpt", "chatgpt", "ChatGPT"),
    ("openai", "chatgpt", "ChatGPT"),
    ("grok", "grok", "Grok Bot"),
)
EXPIRED = "That sign-in has expired. Start again from the app you're connecting."


class Agents:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.registry = Registry(store)
        self.inbox = Inbox()

    @property
    def mcp_url(self) -> str:
        address = agent_address(self.store)
        if address is None:
            raise SourceError(
                "Your agents save to your store, so put your store online first."
            )
        return address

    def connect(self, name: str, app: str) -> dict[str, object]:
        """A key for a new agent, and the block that tells it how to use it."""
        mcp_url = self.mcp_url
        minted = self.inbox.mint(name, app)
        return self._handed(self._add(minted), minted, mcp_url)

    def address(self) -> dict[str, object]:
        """The plain address an app signs in at (XC-068), and a while for Lore to listen for it."""
        mcp_url = self.mcp_url
        self.store.set_setting("agent_sign_in_until", time.time() + EXPECTING)
        return {"mcp_url": mcp_url}

    def allow(
        self, sign_in: str, name: str | None = None, app: str | None = None
    ) -> dict[str, object]:
        """Let the app asking to sign in save to Lore: a new agent, made as a pasted key
        makes one, with the sign-in bound to it."""
        mcp_url = self.mcp_url
        if name is None or app is None:
            asking = next((s for s in self._asking() if s.id == sign_in), None)
            if asking is None:
                raise SourceError(EXPIRED)
            guessed = self.guess(asking.client)
            app, name = app or guessed["app"], name or guessed["name"]
        minted = self.inbox.mint(name, app, sign_in=sign_in)
        source = self._add(minted)
        self.store.set_setting(
            "signed_in_agents", sorted(self._signed_in() | {minted.agent.id})
        )
        return {
            "source": source,
            "agent": minted.agent.model_dump(),
            "mcp_url": mcp_url,
        }

    def deny(self, sign_in: str) -> dict[str, object]:
        self.inbox.deny(sign_in)
        return {"denied": sign_in}

    @staticmethod
    def guess(client: str) -> dict[str, str]:
        """Which agent an app signing in is, by the name it gives itself."""
        named = client.casefold()
        app, name = next(
            ((app, name) for word, app, name in APPS if word in named),
            ("other", client.strip()[:40] or "My agent"),
        )
        return {"app": app, "name": name}

    def key(self, source: str) -> dict[str, object]:
        """A new key for an agent; the one it had stops working at once."""
        mcp_url = self.mcp_url
        agent = self._id(source)
        if agent in self._signed_in():
            raise SourceError(
                "It signed in, so it has no link to replace. Disconnect it, then add Lore in the app again."
            )
        return self._handed(source, self.inbox.rotate(agent), mcp_url)

    def entries(self) -> dict[str, list[dict[str, object]]]:
        local = self._local()
        if not local:
            return {"agents": []}
        counts = self.store.source_counts()
        signed_in = self._signed_in()
        return {
            "agents": [
                {
                    "source": source,
                    "name": agent.name,
                    "app": agent.app,
                    "saved": agent.saved,
                    "waiting": agent.waiting,
                    "last_saved_at": agent.last_saved_at,
                    "memories": counts.get(source, 0),
                    "revoked": agent.revoked,
                    "signed_in": agent.id in signed_in,
                }
                for agent in self.inbox.agents()
                if (source := f"agent-{agent.id}") in local
            ]
        }

    def revoke(self, source: str, *, delete: bool) -> dict[str, object]:
        self._id(source)
        # Keeping its memories keeps what it saved but Lore hasn't brought in, too.
        if not delete:
            self.registry.read([source])
        return self.registry.remove(source, delete=delete)

    def waiting(self) -> dict[str, object]:
        """What the owner's agents saved that Lore hasn't brought in, and the apps asking
        to sign in: one query, and none at all before any agent is connected or
        expected. Apps are shown only while Lore is listening, so a stranger at the
        store's sign-in page can't raise a card for an owner who never asked."""
        local = self._local()
        expecting = self._expecting()
        if not local and not expecting:
            return {"waiting": 0, "sources": [], "sign_ins": []}
        counts, asking = self.inbox.waiting()
        waiting = {
            source: count
            for agent, count in counts.items()
            if (source := f"agent-{agent}") in local and count
        }
        return {
            "waiting": sum(waiting.values()),
            "sources": list(waiting),
            "sign_ins": [self._shown(sign_in) for sign_in in asking]
            if expecting
            else [],
        }

    def _add(self, minted: Minted) -> str:
        """The agent as a source; one that can't be read takes its key back."""
        try:
            added = self.registry.add(
                minted.agent.id,
                minted.agent.name,
                kind="agent",
                connector="agent",
                app=minted.agent.app,
            )
        except SourceError:
            self.inbox.revoke(minted.agent.id)
            raise
        return str(added["name"])

    def _asking(self) -> list[SignIn]:
        return self.inbox.waiting()[1]

    def _expecting(self) -> bool:
        until = self.store.setting("agent_sign_in_until", 0) or 0
        return isinstance(until, (int, float)) and until > time.time()

    def _shown(self, sign_in: SignIn) -> dict[str, object]:
        return {**sign_in.model_dump(), **self.guess(sign_in.client)}

    def _signed_in(self) -> set[str]:
        ids = self.store.setting("signed_in_agents", [])
        return {str(id) for id in ids} if isinstance(ids, list) else set()

    def _local(self) -> set[str]:
        return {source.name for source in self.registry.owned if source.kind == "agent"}

    def _id(self, source: str) -> str:
        if source not in self._local():
            raise SourceError(f"unknown agent: {source}")
        return source.removeprefix("agent-")

    @staticmethod
    def _handed(source: str, minted: Minted, mcp_url: str) -> dict[str, object]:
        prompt = SetupPrompt(minted.agent.name, mcp_url, minted.token)
        return {
            "source": source,
            "agent": minted.agent.model_dump(),
            "mcp_url": mcp_url,
            "connector_url": f"{mcp_url}/{minted.token}",
            "key": minted.token,
            "header": prompt.header,
            "prompt": prompt.render(),
        }
