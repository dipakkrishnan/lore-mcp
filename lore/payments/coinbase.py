"""Authenticated client for Coinbase's hosted x402 facilitator.

Lore builds no payment rail of its own: verification and settlement happen at
Coinbase's facilitator, and this module does nothing but sign short-lived JWTs for
those two calls. It imports the optional ``cdp`` and ``x402`` packages at module
scope, which is safe only because nothing imports *it* until :func:`lore.payments.gate`
has already decided the node is paid.
"""

from __future__ import annotations

from cdp.auth.utils.jwt import JwtOptions, generate_jwt
from x402.http import AuthHeaders, FacilitatorConfig, HTTPFacilitatorClientSync

from .config import PaymentConfig


class CoinbaseAuth:
    """Generate short-lived authentication headers for Coinbase x402 APIs."""

    def __init__(self, config: PaymentConfig):
        self.config = config

    def get_auth_headers(self) -> AuthHeaders:
        def token(method: str, endpoint: str) -> str:
            return generate_jwt(
                JwtOptions(
                    api_key_id=self.config.cdp_api_key_id,
                    api_key_secret=self.config.cdp_api_key_secret,
                    request_method=method,
                    request_host=self.config.coinbase_facilitator_host,
                    request_path=f"{self.config.coinbase_facilitator_path}/{endpoint}",
                    expires_in=120,
                )
            )

        return AuthHeaders(
            verify={"Authorization": f"Bearer {token('POST', 'verify')}"},
            settle={"Authorization": f"Bearer {token('POST', 'settle')}"},
            supported={"Authorization": f"Bearer {token('GET', 'supported')}"},
        )


def client(config: PaymentConfig) -> HTTPFacilitatorClientSync:
    """Create Coinbase's hosted x402 facilitator client."""
    return HTTPFacilitatorClientSync(
        FacilitatorConfig(
            url=config.coinbase_facilitator_url,
            auth_provider=CoinbaseAuth(config),
        )
    )
