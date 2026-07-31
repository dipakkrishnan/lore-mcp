"""x402 payment gate over the ``answer`` tool.

One transport note, because the protocol's name invites confusion: at the MCP layer
the challenge is *in-band*. ``tools/call`` succeeds at the transport level and the
payment requirements come back inside the tool result, via x402's MCP wrapper. "402"
survives as the protocol's name, not as an HTTP status anywhere in this path.
"""

from __future__ import annotations

from typing import Any

from x402.mcp import (
    MCPToolResult,
    ResourceInfo,
    SyncPaymentWrapperConfig,
    create_payment_wrapper_sync,
)
from x402.mechanisms.evm.exact import ExactEvmServerScheme
from x402.schemas import ResourceConfig
from x402.server import x402ResourceServerSync

from . import PaymentGate, ToolHandler
from .coinbase import client
from .config import PaymentConfig

RESOURCE_URL = "mcp://tool/answer"


def price_label(price_usd: float) -> str:
    """Render a USD price the way the payment requirements quote it."""
    return f"${price_usd:.6f}".rstrip("0").rstrip(".")


def gate(price_usd: float, handler: ToolHandler, config: PaymentConfig) -> PaymentGate:
    """Build an x402 MCP gate for one fixed-price answer tool."""
    if price_usd <= 0:
        raise ValueError("answer price must be positive")
    server = x402ResourceServerSync(client(config))
    server.register(config.x402_network, ExactEvmServerScheme())
    server.initialize()
    accepts = server.build_payment_requirements(
        ResourceConfig(
            scheme="exact",
            network=config.x402_network,
            pay_to=config.x402_pay_to,
            price=price_label(price_usd),
            extra={"name": "USDC", "version": "2"},
        )
    )

    paid = create_payment_wrapper_sync(
        server,
        SyncPaymentWrapperConfig(
            accepts=accepts,
            resource=ResourceInfo(
                url=RESOURCE_URL,
                # Deliberately generic. The challenge is issued before payment, so
                # anything specific here is content disclosed for free.
                description="Answer from owner-approved Lore",
                mime_type="application/json",
            ),
        ),
    )(lambda arguments, _: MCPToolResult(**_result_kwargs(handler(arguments))))

    def call(arguments: dict[str, Any], meta: object) -> dict[str, Any]:
        result = paid(
            arguments,
            {"toolName": "answer", "_meta": meta if isinstance(meta, dict) else {}},
        )
        response: dict[str, Any] = {
            "content": result.content,
            "isError": result.is_error,
        }
        if result.meta:
            response["_meta"] = result.meta
        if result.structured_content:
            response["structuredContent"] = result.structured_content
        return response

    return call


def _result_kwargs(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "content": result.get("content", []),
        "is_error": result.get("isError", False),
        "meta": result.get("_meta"),
        "structured_content": result.get("structuredContent"),
    }
