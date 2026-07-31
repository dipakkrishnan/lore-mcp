"""Payment boundary for paid Lore answers.

Payment is enforced in-process, at the MCP layer, by Lore itself — there is no edge
gateway in this path. The gate decides *whether* a caller gets an answer; it never
decides *what* is answerable. A paid answer and a free answer read from exactly the
same ``publications WHERE active=1``.

Nothing in this package may be imported at module scope by the rest of Lore. The
``x402`` and ``cdp`` packages are an optional extra, and an owner who never sets a
price must never need them installed — so every import of them sits behind
:func:`gate`, after the free early return.
"""

from __future__ import annotations

import math
from collections.abc import Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # Importing for types must not drag in the optional extra.
    from .config import PaymentConfig

ToolHandler = Callable[[dict[str, Any]], dict[str, Any]]
PaymentGate = Callable[[dict[str, Any], object], dict[str, Any]]


def gate(
    price_usd: object,
    handler: ToolHandler,
    config: "PaymentConfig | None" = None,
) -> PaymentGate | None:
    """Return the configured answer gate, or None when answers are free.

    Returning None is the whole free path: no gate is constructed, no facilitator is
    contacted, and neither ``x402`` nor ``cdp`` is imported.
    """
    if price_usd is None:
        return None
    if (
        isinstance(price_usd, bool)
        or not isinstance(price_usd, (int, float))
        or not math.isfinite(price_usd)
    ):
        raise ValueError("answer price must be a number")
    if price_usd == 0:
        return None
    if price_usd < 0:
        raise ValueError("answer price must not be negative")

    from .config import resolve

    config = resolve() if config is None else config
    config.validate_paid()

    from .x402 import gate as x402_gate

    return x402_gate(float(price_usd), handler, config)
