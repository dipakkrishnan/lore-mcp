"""List a store on the public Lore marketplace (XC-036).

The marketplace is `marketplace.json` in dipakkrishnan/lore-marketplace. A
workflow there rewrites every entry daily from each node's own `discover`, and
keeps only nodes whose `discover` says `"listed": true`. So the node is the
proof of ownership: listing switches this store on (a push that sets its
listed name) and hands back the prefilled request form; delisting switches it
off, and the next daily refresh drops the entry. Nothing here holds a
credential.
"""

from __future__ import annotations

import contextlib
import json
import os
import sys
import urllib.parse
import urllib.request
from typing import Callable, Literal

from pydantic import BaseModel, ConfigDict

from . import blueprint, feedback
from .store import Store
from .ui import CONTROL_CHARACTERS

REGISTRY = "dipakkrishnan/lore-marketplace"
NAME_SETTING = "listed_name"
MAX_NAME = 80


class Listing(BaseModel):
    """Where this store stands on the public list."""

    model_config = ConfigDict(frozen=True)

    state: Literal["none", "pending", "listed"]
    action: Literal["list", "delist"] | None = None
    url: str | None = None


class Marketplace:
    def __init__(self, push: Callable[[], object]) -> None:
        self.push = push
        with Store() as store:
            node = store.setting("node_url", None)
            self.name = str(store.setting(NAME_SETTING, ""))
        if not isinstance(node, str) or not node:
            raise ValueError("open your store before listing it")
        self.node = node
        self.file_url = os.environ.get(
            "LORE_MARKETPLACE_URL",
            f"https://raw.githubusercontent.com/{REGISTRY}/main/marketplace.json",
        )

    def request_url(self) -> str:
        query = urllib.parse.urlencode({"template": "listing.yml", "node": self.node})
        return f"https://github.com/{REGISTRY}/issues/new?{query}"

    def _on_file(self) -> bool:
        request = urllib.request.Request(
            self.file_url, headers={"User-Agent": feedback.USER_AGENT}
        )
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                sellers = json.loads(response.read())["sellers"]
        except (OSError, ValueError, KeyError) as error:
            raise OSError(
                "could not read the public list of Lore sellers; check your connection"
            ) from error
        return any(seller.get("node") == self.node for seller in sellers)

    def status(self) -> Listing:
        on_file = self._on_file()
        if on_file and self.name:
            return Listing(state="listed")
        if on_file:
            return Listing(state="pending", action="delist")
        if self.name:
            return Listing(state="pending", action="list", url=self.request_url())
        return Listing(state="none")

    def list(self, name: str | None = None) -> Listing:
        chosen = (name or _setup_name()).translate(CONTROL_CHARACTERS).strip()
        if not chosen:
            raise ValueError("a display name is needed; pass --name")
        if len(chosen) > MAX_NAME:
            raise ValueError(f"the display name is over {MAX_NAME} characters")
        self._switch(chosen)
        return Listing(state="pending", action="list", url=self.request_url())

    def delist(self) -> Listing:
        self._switch("")
        return Listing(state="none")

    def _switch(self, name: str) -> None:
        """Save the listed name and push it, so the node's discover says it."""
        with Store() as store:
            store.set_setting(NAME_SETTING, name)
        try:
            with contextlib.redirect_stdout(sys.stderr):
                self.push()
        except BaseException:
            with Store() as store:
                store.set_setting(NAME_SETTING, self.name)
            raise
        self.name = name


def _setup_name() -> str:
    saved = blueprint.load_blueprint()
    name = saved.get("name") if saved else None
    return name if isinstance(name, str) else ""
