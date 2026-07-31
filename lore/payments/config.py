"""Payment configuration, resolved from the environment and from Lore's own settings.

The owner-facing skill persists a payout address and network as Lore settings, and
writes the CDP credentials to a ``0600`` file. None of that takes effect unless the
configuration is *resolved* rather than read from ``os.environ`` at import — which is
why this module exposes :func:`resolve` and no module-scope singleton.

Environment variables still win wherever both are present, so a headless or deployed
node can be configured entirely from its environment with nothing persisted locally.
"""

from __future__ import annotations

import os
import re

from pydantic import BaseModel

BASE_MAINNET = "eip155:8453"
BASE_SEPOLIA = "eip155:84532"
BASE_NETWORKS = {BASE_MAINNET, BASE_SEPOLIA}

# Testnet first, always. Nothing configures mainnet until a testnet payment settles.
DEFAULT_NETWORK = BASE_SEPOLIA

NETWORK_NAMES = {BASE_MAINNET: "Base", BASE_SEPOLIA: "Base Sepolia"}

PAY_TO_SETTING = "x402_pay_to"
NETWORK_SETTING = "x402_network"

EVM_ADDRESS = re.compile(r"0x[0-9a-fA-F]{40}")


class PaymentConfig(BaseModel):
    """One resolved snapshot of what it takes to charge for an answer."""

    coinbase_facilitator_url: str = "https://api.cdp.coinbase.com/platform/v2/x402"
    coinbase_facilitator_host: str = "api.cdp.coinbase.com"
    coinbase_facilitator_path: str = "/platform/v2/x402"
    x402_pay_to: str = ""
    x402_network: str = DEFAULT_NETWORK
    cdp_api_key_id: str = ""
    cdp_api_key_secret: str = ""

    def validate_paid(self) -> None:
        """Reject incomplete or unsupported paid-answer configuration.

        Messages name the missing item in the owner's terms and the command that
        supplies it. A buyer never sees these — they are raised at server start.
        """
        if not self.x402_pay_to:
            raise ValueError(
                "no payout address configured — run the lore-enable-payments skill, "
                "or set LORE_X402_PAY_TO"
            )
        if not EVM_ADDRESS.fullmatch(self.x402_pay_to):
            raise ValueError(
                "payout address must be an EVM address (0x followed by 40 hex "
                f"characters); got {self.x402_pay_to!r}"
            )
        # Never interpolate the secret into an error, whole or partial.
        if not self.cdp_api_key_id or not self.cdp_api_key_secret:
            missing = "id" if not self.cdp_api_key_id else "secret"
            raise ValueError(
                f"no Coinbase CDP key {missing} configured — run `lore payment auth`, "
                "or set CDP_API_KEY_ID and CDP_API_KEY_SECRET"
            )
        if self.x402_network not in BASE_NETWORKS:
            supported = ", ".join(f"{name} ({net})" for net, name in NETWORK_NAMES.items())
            raise ValueError(
                f"unsupported payment network {self.x402_network!r}; Lore supports "
                f"{supported}"
            )

    def missing(self) -> str | None:
        """Return the first owner-facing problem with this configuration, if any."""
        try:
            self.validate_paid()
        except ValueError as error:
            return str(error)
        return None

    @property
    def network_name(self) -> str:
        """Return the human name for the configured network."""
        return NETWORK_NAMES.get(self.x402_network, self.x402_network)

    @property
    def is_mainnet(self) -> bool:
        """Report whether this configuration moves real money."""
        return self.x402_network == BASE_MAINNET


def _environment(name: str) -> str:
    return os.environ.get(name, "").strip()


def resolve(store: object | None = None) -> PaymentConfig:
    """Build the effective payment configuration.

    Precedence is environment first, then what the owner persisted locally. The
    environment wins so that a deployed node — which has no ``$LORE_HOME`` settings
    to read — stays configurable, and so that an override is always available
    without editing stored state.
    """
    from ..store import Store

    from . import credentials

    settings: dict[str, str] = {}
    if store is None:
        with Store() as opened:
            settings = _settings(opened)
    else:
        settings = _settings(store)

    stored = credentials.load()

    # A PEM-style secret carries newlines that survive an env var only when escaped.
    environment_secret = _environment("CDP_API_KEY_SECRET").replace("\\n", "\n")

    return PaymentConfig(
        x402_pay_to=_environment("LORE_X402_PAY_TO") or settings.get(PAY_TO_SETTING, ""),
        x402_network=(
            _environment("LORE_X402_NETWORK")
            or settings.get(NETWORK_SETTING, "")
            or DEFAULT_NETWORK
        ),
        cdp_api_key_id=_environment("CDP_API_KEY_ID") or stored.get("cdp_api_key_id", ""),
        cdp_api_key_secret=environment_secret or stored.get("cdp_api_key_secret", ""),
    )


def _settings(store: object) -> dict[str, str]:
    """Read the payment settings an owner persisted, as plain strings."""
    values = {}
    for key in (PAY_TO_SETTING, NETWORK_SETTING):
        value = store.setting(key, "")  # type: ignore[attr-defined]
        values[key] = str(value).strip() if value else ""
    return values


def normalize_pay_to(address: object) -> str:
    """Validate a payout address up front, rather than at the first buyer's call."""
    if not isinstance(address, str):
        raise ValueError("payout address must be a string")
    address = address.strip()
    if not EVM_ADDRESS.fullmatch(address):
        raise ValueError(
            "payout address must be an EVM address (0x followed by 40 hex "
            f"characters); got {address!r}"
        )
    return address


def normalize_network(network: object) -> str:
    """Validate a network identifier against the two Lore supports."""
    if not isinstance(network, str):
        raise ValueError("network must be a string")
    network = network.strip()
    aliases = {"base": BASE_MAINNET, "base-sepolia": BASE_SEPOLIA, "sepolia": BASE_SEPOLIA}
    network = aliases.get(network.lower(), network)
    if network not in BASE_NETWORKS:
        supported = ", ".join(f"{name} ({net})" for net, name in NETWORK_NAMES.items())
        raise ValueError(f"unsupported payment network {network!r}; Lore supports {supported}")
    return network
