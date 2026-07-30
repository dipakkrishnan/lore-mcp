"""Payment boundary for paid Lore tools."""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import Any

from . import config

ToolHandler = Callable[[dict[str, Any]], dict[str, Any]]
PaymentGate = Callable[[dict[str, Any], object], dict[str, Any]]

from .x402 import gate as x402_gate


def gate(price_usd: object, handler: ToolHandler) -> PaymentGate | None:
    """Return the configured answer gate, or None when answers are free."""
    if price_usd in (None, 0):
        return None
    if (
        isinstance(price_usd, bool)
        or not isinstance(price_usd, (int, float))
        or not math.isfinite(price_usd)
    ):
        raise ValueError("answer price must be a number")
    config.CONFIG.validate_paid()

    return x402_gate(float(price_usd), handler)
