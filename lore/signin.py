"""Signing in to an app's own server. The MCP SDK runs the OAuth; this module only
keeps what it hands back in the Keychain and catches the browser's answer."""

from __future__ import annotations

import logging
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from typing import TypeVar
from urllib.parse import parse_qs, urlsplit

import anyio.to_thread
import keyring
from keyring.errors import PasswordDeleteError
from mcp.client.auth import AuthorizationCodeResult, OAuthFlowError
from mcp.shared.auth import OAuthClientInformationFull, OAuthToken
from pydantic import BaseModel

Saved = TypeVar("Saved", bound=BaseModel)

# The SDK logs a traceback for every run-out sign-in; Lore shows it as the app's state.
logging.getLogger("mcp").addHandler(logging.NullHandler())


class Keychain:
    """The SDK's token storage, one Keychain entry per server and kind: nothing on disk."""

    service = "Lore"

    def __init__(self, server: str) -> None:
        self.server = server

    async def get_tokens(self) -> OAuthToken | None:
        return self._load("tokens", OAuthToken)

    async def set_tokens(self, tokens: OAuthToken) -> None:
        self._save("tokens", tokens)

    async def get_client_info(self) -> OAuthClientInformationFull | None:
        return self._load("client", OAuthClientInformationFull)

    async def set_client_info(self, client_info: OAuthClientInformationFull) -> None:
        self._save("client", client_info)

    def forget(self) -> None:
        for kind in ("tokens", "client"):
            try:
                keyring.delete_password(self.service, f"{self.server} {kind}")
            except PasswordDeleteError:
                pass

    def _load(self, kind: str, model: type[Saved]) -> Saved | None:
        saved = keyring.get_password(self.service, f"{self.server} {kind}")
        return model.model_validate_json(saved) if saved else None

    def _save(self, kind: str, value: BaseModel) -> None:
        keyring.set_password(
            self.service, f"{self.server} {kind}", value.model_dump_json()
        )


class Loopback(HTTPServer):
    """Where the browser lands once the owner answers the app's approval page."""

    wait = 300.0

    def __init__(self) -> None:
        super().__init__(("127.0.0.1", 0), _Landing)
        self.timeout = self.wait
        self.answer: dict[str, str] | None = None

    @property
    def redirect(self) -> str:
        return f"http://127.0.0.1:{self.server_port}/callback"

    async def callback(self) -> AuthorizationCodeResult:
        await anyio.to_thread.run_sync(self._listen)
        answer = self.answer or {}
        if "code" not in answer:
            raise OAuthFlowError(answer.get("error", "no answer from the browser"))
        return AuthorizationCodeResult.model_validate(answer)

    def _listen(self) -> None:
        # A browser asks for more than the callback (a favicon), so keep answering until it lands.
        deadline = time.monotonic() + self.wait
        while self.answer is None and time.monotonic() < deadline:
            self.handle_request()


class _Landing(BaseHTTPRequestHandler):
    server: Loopback

    def do_GET(self) -> None:
        url = urlsplit(self.path)
        if url.path != "/callback":
            self.send_error(404)
            return
        answer = {key: values[0] for key, values in parse_qs(url.query).items()}
        self.server.answer = answer
        said = (
            "Lore is connected. You can close this tab."
            if "code" in answer
            else "Lore was not let in. You can close this tab."
        )
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(f"<!doctype html><title>Lore</title><p>{said}</p>".encode())

    def log_message(self, format: str, *args: object) -> None:
        pass
