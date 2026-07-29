"""Environment-backed payment configuration."""

from __future__ import annotations

import os
import re

from pydantic import BaseModel, Field

BASE_NETWORKS = {"eip155:8453", "eip155:84532"}


class PaymentConfig(BaseModel):
    """Process-level payment settings."""

    coinbase_facilitator_url: str = "https://api.cdp.coinbase.com/platform/v2/x402"
    coinbase_facilitator_host: str = "api.cdp.coinbase.com"
    coinbase_facilitator_path: str = "/platform/v2/x402"
    x402_pay_to: str = Field(
        default_factory=lambda: os.environ.get("LORE_X402_PAY_TO", "").strip()
    )
    x402_network: str = Field(
        default_factory=lambda: os.environ.get("LORE_X402_NETWORK", "eip155:84532")
    )
    cdp_api_key_id: str = Field(
        default_factory=lambda: os.environ.get("CDP_API_KEY_ID", "").strip()
    )
    cdp_api_key_secret: str = Field(
        default_factory=lambda: os.environ.get("CDP_API_KEY_SECRET", "")
        .strip()
        .replace("\\n", "\n")
    )

    def validate_paid(self) -> None:
        """Reject incomplete or unsupported paid-answer configuration."""
        for name, value in (
            ("LORE_X402_PAY_TO", self.x402_pay_to),
            ("CDP_API_KEY_ID", self.cdp_api_key_id),
            ("CDP_API_KEY_SECRET", self.cdp_api_key_secret),
        ):
            if not value:
                raise ValueError(f"{name} is required for paid answers")
        if self.x402_network not in BASE_NETWORKS:
            raise ValueError("LORE_X402_NETWORK must be Base or Base Sepolia")
        if not re.fullmatch(r"0x[0-9a-fA-F]{40}", self.x402_pay_to):
            raise ValueError("LORE_X402_PAY_TO must be an EVM address")


CONFIG = PaymentConfig()
