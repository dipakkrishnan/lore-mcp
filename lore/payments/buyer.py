"""A minimal x402 buyer, so the owner's payment gate can be tested before mainnet.

Nothing else in Lore can *pay*. Without a payer the testnet transaction the owner is
told to run has no counterparty and cannot happen at all, so the only alternative to
shipping this is asking the owner to trust an unexercised payment path with real
money.

It is a test harness and nothing more: one query, one payment, one report. It is
driven by a second owner-controlled testnet wallet, never by the payout wallet — a
node paying itself proves nothing about whether a buyer can pay it.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from typing import Any

from .config import PaymentConfig

# Mirrors the server's own cap in lore.mcp.http.
MAX_RESPONSE_BYTES = 1_000_000


class _Result:
    """One MCP tool result, shaped the way x402's client helpers read it."""

    def __init__(self, payload: dict[str, Any]):
        self.content = payload.get("content", [])
        self.isError = payload.get("isError", False)
        self._meta = payload.get("_meta", {}) or {}
        self.structuredContent = payload.get("structuredContent")


class _JsonRpcClient:
    """The smallest MCP client that can talk to `lore serve --transport http`.

    Lore's HTTP transport is a plain JSON-RPC POST endpoint rather than SSE, so
    x402's bundled SSE client does not fit. This adapter supplies the one method
    ``x402MCPClientSync`` actually calls.
    """

    def __init__(self, url: str, token: str | None = None, timeout: float = 30.0):
        self.url = url
        self.token = token
        self.timeout = timeout
        self._id = 0

    def call_tool(self, params: dict[str, Any], **_: Any) -> _Result:
        self._id += 1
        body = json.dumps(
            {"jsonrpc": "2.0", "id": self._id, "method": "tools/call", "params": params}
        ).encode()
        headers = {"Content-Type": "application/json"}
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(self.url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read(MAX_RESPONSE_BYTES + 1)
        except urllib.error.URLError as error:
            raise ValueError(f"could not reach the Lore node at {self.url}: {error.reason}")
        if len(raw) > MAX_RESPONSE_BYTES:
            raise ValueError("the Lore node returned an oversized response")
        message = json.loads(raw)
        if "error" in message:
            raise ValueError(f"the Lore node rejected the call: {message['error']['message']}")
        return _Result(message.get("result", {}))


def _challenge(result: _Result) -> dict[str, Any] | None:
    """Return the payment requirements a challenge carries, if this is one."""
    if not result.isError:
        return None
    structured = result.structuredContent
    if isinstance(structured, dict) and "accepts" in structured:
        return structured
    for item in result.content:
        text = item.get("text") if isinstance(item, dict) else getattr(item, "text", None)
        if not isinstance(text, str):
            continue
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict) and "accepts" in parsed:
            return parsed
    return None


def leaked_terms(challenge: object, terms: list[str]) -> list[str]:
    """Return any of `terms` that appear in a challenge.

    A payment gate that leaks the answer inside its own challenge is worse than no
    gate: the buyer gets the content and keeps the money. The harness checks rather
    than assumes.
    """
    rendered = json.dumps(challenge, default=str).casefold()
    return [term for term in terms if term and term.casefold() in rendered]


def test_buy(
    url: str,
    query: str,
    private_key: str,
    config: PaymentConfig,
    token: str | None = None,
    watch_for: list[str] | None = None,
) -> dict[str, Any]:
    """Run one unpaid call and one paid retry against a live Lore node.

    Returns a report of what happened at each step. Raises rather than returning a
    partial success, so a caller can never mistake a failed settlement for a working
    payment path.
    """
    from eth_account import Account
    from x402.client import x402ClientSync
    from x402.mcp.client import x402MCPClientSync
    from x402.mechanisms.evm.exact.register import register_exact_evm_client
    from x402.mechanisms.evm.signers import EthAccountSigner

    try:
        account = Account.from_key(private_key.strip())
    except (ValueError, TypeError):
        # Never echo the key, or any slice of it, in the failure.
        raise ValueError("the test buyer key is not a valid EVM private key")

    transport = _JsonRpcClient(url, token)
    arguments = {"query": query}

    # Step one: call unpaid, and hold on to the challenge for inspection.
    unpaid = transport.call_tool({"name": "answer", "arguments": arguments})
    challenge = _challenge(unpaid)
    if challenge is None:
        raise ValueError(
            "the node answered without asking for payment — check that a price is set "
            "with `lore price` and that the node was restarted after setting it"
        )
    leaked = leaked_terms(challenge, watch_for or [])
    if leaked:
        raise ValueError(
            f"the payment challenge disclosed publication content ({leaked[0]!r}); "
            "refusing to continue"
        )

    payment_client = x402ClientSync()
    register_exact_evm_client(payment_client, EthAccountSigner(account), config.x402_network)

    # Step two: let x402's own client redo the call and pay for it, so the harness
    # exercises the real client path rather than a hand-rolled approximation.
    paid = x402MCPClientSync(transport, payment_client).call_tool("answer", arguments)
    if paid.is_error or not paid.payment_made:
        raise ValueError(
            "payment did not settle — the price is left unset rather than half-"
            "configuring a node that challenges every buyer and can never settle"
        )

    accepted = (challenge.get("accepts") or [{}])[0]
    settlement = paid.payment_response
    if hasattr(settlement, "model_dump"):
        settlement = settlement.model_dump()
    return {
        "buyer": account.address,
        "network": config.x402_network,
        "network_name": config.network_name,
        "pay_to": accepted.get("payTo", config.x402_pay_to),
        "price": accepted.get("maxAmountRequired") or accepted.get("price"),
        "challenge_disclosed_content": False,
        "settled": True,
        "transaction": (settlement or {}).get("transaction"),
        "answer": [
            item.get("text") if isinstance(item, dict) else getattr(item, "text", "")
            for item in paid.content
        ],
    }
