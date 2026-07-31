"""Client for the x402 facilitator that verifies and settles payments.

Lore builds no payment rail of its own: verification and settlement happen at a
facilitator, and this module does nothing but point at one and, where required, sign
short-lived JWTs for its calls.

Two facilitators are in play. Coinbase's hosted one settles real money and
authenticates every call. The x402 project's public one serves test networks only and
takes no credentials — which is why a testnet run needs no Coinbase account, and the
auth path below is skipped entirely for it.

It imports the optional ``cdp`` and ``x402`` packages at module scope, which is safe
only because nothing imports *it* until :func:`lore.payments.gate` has already decided
the node is paid.
"""

from __future__ import annotations

from x402.http import AuthHeaders, FacilitatorConfig, HTTPFacilitatorClientSync

from .config import PaymentConfig


class CoinbaseAuth:
    """Generate short-lived authentication headers for Coinbase x402 APIs."""

    def __init__(self, config: PaymentConfig):
        self.config = config

    def get_auth_headers(self) -> AuthHeaders:
        # Imported here rather than at module scope so a credential-free testnet run
        # never needs the `cdp` package to be importable at all.
        from cdp.auth.utils.jwt import JwtOptions, generate_jwt

        def token(method: str, endpoint: str) -> str:
            return generate_jwt(
                JwtOptions(
                    api_key_id=self.config.cdp_api_key_id,
                    api_key_secret=self.config.cdp_api_key_secret,
                    request_method=method,
                    request_host=self.config.facilitator_host,
                    request_path=f"{self.config.facilitator_path}/{endpoint}",
                    expires_in=120,
                )
            )

        return AuthHeaders(
            verify={"Authorization": f"Bearer {token('POST', 'verify')}"},
            settle={"Authorization": f"Bearer {token('POST', 'settle')}"},
            supported={"Authorization": f"Bearer {token('GET', 'supported')}"},
        )


def client(config: PaymentConfig) -> HTTPFacilitatorClientSync:
    """Create the facilitator client this configuration calls for."""
    if not config.requires_cdp_credentials:
        # The public testnet facilitator takes no credentials; attaching an auth
        # provider would only make it fail for want of keys it never asked for.
        return HTTPFacilitatorClientSync(FacilitatorConfig(url=config.facilitator_url))
    return HTTPFacilitatorClientSync(
        FacilitatorConfig(url=config.facilitator_url, auth_provider=CoinbaseAuth(config))
    )
