"""The owner's personal agents (CAP-036): each one a key to the owner's own store and
a source, read like every other source and shown with what it has saved."""

from __future__ import annotations

from .inbox import Inbox, Minted, SetupPrompt
from .sources import Registry, SourceError
from .store import Store


class Agents:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.registry = Registry(store)
        self.inbox = Inbox()

    @property
    def mcp_url(self) -> str:
        node = str(self.store.setting("node_url", "") or "")
        if not node:
            raise SourceError(
                "Your agents save to your store, so put your store online first."
            )
        return node.rstrip("/").removesuffix("/mcp") + "/agent"

    def connect(self, name: str, app: str) -> dict[str, object]:
        """A key for a new agent, and the block that tells it how to use it."""
        mcp_url = self.mcp_url
        minted = self.inbox.mint(name, app)
        try:
            added = self.registry.add(
                minted.agent.id,
                minted.agent.name,
                kind="agent",
                connector="agent",
                app=app,
            )
        except SourceError:
            self.inbox.revoke(minted.agent.id)
            raise
        return self._handed(str(added["name"]), minted, mcp_url)

    def key(self, source: str) -> dict[str, object]:
        """A new key for an agent; the one it had stops working at once."""
        mcp_url = self.mcp_url
        return self._handed(source, self.inbox.rotate(self._id(source)), mcp_url)

    def entries(self) -> dict[str, list[dict[str, object]]]:
        local = self._local()
        if not local:
            return {"agents": []}
        counts = self.store.source_counts()
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
        """What the owner's agents saved that Lore hasn't brought in: one query, and
        none at all before any agent is connected."""
        local = self._local()
        if not local:
            return {"waiting": 0, "sources": []}
        waiting = {
            source: count
            for agent, count in self.inbox.waiting().items()
            if (source := f"agent-{agent}") in local and count
        }
        return {"waiting": sum(waiting.values()), "sources": list(waiting)}

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
            "key": minted.token,
            "header": prompt.header,
            "prompt": prompt.render(),
        }
