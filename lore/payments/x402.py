"""x402 payment gate backed by Coinbase's hosted facilitator."""

from __future__ import annotations

import os
import re
from typing import Any

from . import PaymentGate, ToolHandler

FACILITATOR_URL = "https://api.cdp.coinbase.com/platform/v2/x402"
FACILITATOR_HOST = "api.cdp.coinbase.com"
FACILITATOR_PATH = "/platform/v2/x402"
BASE_NETWORKS = {"eip155:8453", "eip155:84532"}


def gate(price_usd: float, handler: ToolHandler) -> PaymentGate:
    """Build an x402 MCP gate for one fixed-price answer tool."""
    pay_to = _required("LORE_X402_PAY_TO")
    key_id = _required("CDP_API_KEY_ID")
    key_secret = _required("CDP_API_KEY_SECRET").replace("\\n", "\n")
    network = os.environ.get("LORE_X402_NETWORK", "eip155:84532")

    if price_usd <= 0:
        raise ValueError("answer price must be positive")
    if network not in BASE_NETWORKS:
        raise ValueError("LORE_X402_NETWORK must be Base or Base Sepolia")
    if not re.fullmatch(r"0x[0-9a-fA-F]{40}", pay_to):
        raise ValueError("LORE_X402_PAY_TO must be an EVM address")

    from cdp.auth.utils.jwt import JwtOptions, generate_jwt
    from x402.http import (
        AuthHeaders,
        FacilitatorConfig,
        HTTPFacilitatorClientSync,
    )
    from x402.mcp import (
        MCPToolResult,
        ResourceInfo,
        SyncPaymentWrapperConfig,
        create_payment_wrapper_sync,
    )
    from x402.mechanisms.evm.exact import ExactEvmServerScheme
    from x402.schemas import ResourceConfig
    from x402.server import x402ResourceServerSync

    class CoinbaseAuth:
        def get_auth_headers(self) -> AuthHeaders:
            def token(method: str, endpoint: str) -> str:
                return generate_jwt(
                    JwtOptions(
                        api_key_id=key_id,
                        api_key_secret=key_secret,
                        request_method=method,
                        request_host=FACILITATOR_HOST,
                        request_path=f"{FACILITATOR_PATH}/{endpoint}",
                        expires_in=120,
                    )
                )

            return AuthHeaders(
                verify={"Authorization": f"Bearer {token('POST', 'verify')}"},
                settle={"Authorization": f"Bearer {token('POST', 'settle')}"},
                supported={"Authorization": f"Bearer {token('GET', 'supported')}"},
            )

    facilitator = HTTPFacilitatorClientSync(
        FacilitatorConfig(url=FACILITATOR_URL, auth_provider=CoinbaseAuth())
    )
    server = x402ResourceServerSync(facilitator)
    server.register(network, ExactEvmServerScheme())
    server.initialize()
    accepts = server.build_payment_requirements(
        ResourceConfig(
            scheme="exact",
            network=network,
            pay_to=pay_to,
            price=f"${price_usd:.6f}".rstrip("0").rstrip("."),
            extra={"name": "USDC", "version": "2"},
        )
    )

    paid = create_payment_wrapper_sync(
        server,
        SyncPaymentWrapperConfig(
            accepts=accepts,
            resource=ResourceInfo(
                url="mcp://tool/answer",
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


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ValueError(f"{name} is required for paid answers")
    return value


def _result_kwargs(result: dict[str, Any]) -> dict[str, Any]:
    return {
        "content": result.get("content", []),
        "is_error": result.get("isError", False),
        "meta": result.get("_meta"),
        "structured_content": result.get("structuredContent"),
    }
