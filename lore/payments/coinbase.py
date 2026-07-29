"""Authenticated Coinbase facilitator client."""

from __future__ import annotations

from cdp.auth.utils.jwt import JwtOptions, generate_jwt
from x402.http import (
    AuthHeaders,
    FacilitatorConfig,
    HTTPFacilitatorClientSync,
)

from . import config


class CoinbaseAuth:
    """Generate short-lived authentication headers for Coinbase x402 APIs."""

    def get_auth_headers(self) -> AuthHeaders:
        def token(method: str, endpoint: str) -> str:
            return generate_jwt(
                JwtOptions(
                    api_key_id=config.CONFIG.cdp_api_key_id,
                    api_key_secret=config.CONFIG.cdp_api_key_secret,
                    request_method=method,
                    request_host=config.CONFIG.coinbase_facilitator_host,
                    request_path=f"{config.CONFIG.coinbase_facilitator_path}/{endpoint}",
                    expires_in=120,
                )
            )

        return AuthHeaders(
            verify={"Authorization": f"Bearer {token('POST', 'verify')}"},
            settle={"Authorization": f"Bearer {token('POST', 'settle')}"},
            supported={"Authorization": f"Bearer {token('GET', 'supported')}"},
        )


def client() -> HTTPFacilitatorClientSync:
    """Create Coinbase's hosted x402 facilitator client."""
    return HTTPFacilitatorClientSync(
        FacilitatorConfig(
            url=config.CONFIG.coinbase_facilitator_url,
            auth_provider=CoinbaseAuth(),
        )
    )
