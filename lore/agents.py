"""The owner's personal agents (CAP-036): each one an inbox key and a source, read
like every other source and shown with what it has saved."""

from __future__ import annotations

from .inbox import Agent, Inbox, SetupPrompt
from .sources import Registry, SourceError
from .store import Store


class Agents:
    def __init__(self, store: Store) -> None:
        self.store = store
        self.registry = Registry(store)
        self.inbox = Inbox()

    def connect(self, name: str, app: str) -> dict[str, object]:
        """A key for a new agent, and the block that tells it how to use it."""
        self.inbox.register()
        minted = self.inbox.mint(name, app)
        try:
            added = self.registry.add(
                minted.agent.id, name, kind="agent", connector="agent", app=app
            )
        except SourceError:
            self.inbox.revoke(minted.agent.id)
            raise
        return self._handed(
            str(added["name"]), minted.agent, minted.token, minted.mcp_url
        )

    def key(self, source: str) -> dict[str, object]:
        """A new key for an agent; the one it had stops working at once."""
        agent = self._agent(source)
        return self._handed(
            source, agent, self.inbox.rotate(agent.id), self.inbox.mcp_url
        )

    def entries(self) -> dict[str, list[dict[str, object]]]:
        local = self._local()
        if not (local and self.inbox.identity):
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
                for agent in self.inbox.me().agents
                if (source := f"agent-{agent.id}") in local
            ]
        }

    def revoke(self, source: str, *, delete: bool) -> dict[str, object]:
        if source not in self._local():
            raise SourceError(f"unknown agent: {source}")
        # Keeping its memories keeps what it saved but Lore hasn't collected yet, too.
        if not delete:
            self.registry.read([source])
        return self.registry.remove(source, delete=delete)

    def waiting(self) -> dict[str, object]:
        """What the owner's agents saved that Lore hasn't brought in: one request,
        and none at all before any agent is connected."""
        local = self._local()
        if not (local and self.inbox.identity):
            return {"waiting": 0, "sources": []}
        waiting = {
            source: agent.waiting
            for agent in self.inbox.me().agents
            if (source := f"agent-{agent.id}") in local and agent.waiting
        }
        return {"waiting": sum(waiting.values()), "sources": list(waiting)}

    def _local(self) -> set[str]:
        return {source.name for source in self.registry.owned if source.kind == "agent"}

    def _agent(self, source: str) -> Agent:
        if source in self._local():
            for agent in self.inbox.me().agents:
                if f"agent-{agent.id}" == source:
                    return agent
        raise SourceError(f"unknown agent: {source}")

    @staticmethod
    def _handed(
        source: str, agent: Agent, token: str, mcp_url: str
    ) -> dict[str, object]:
        prompt = SetupPrompt(agent.name, mcp_url, token)
        return {
            "source": source,
            "agent": agent.model_dump(),
            "mcp_url": mcp_url,
            "key": token,
            "header": prompt.header,
            "prompt": prompt.render(),
        }
