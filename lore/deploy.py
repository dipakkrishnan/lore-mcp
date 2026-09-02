"""Deploy the owner's Lore node to their own Cloudflare account.

The Worker source ships inside this package (`lore/node`), so deployment never
needs the git repository: `lore node deploy` materializes the source to
`~/.lore/node`, then drives npm and wrangler there. The Worker version always
matches the installed CLI version — the property that matters once `lore push`
and the Worker share a D1 schema (MON-003).
"""

from __future__ import annotations

import json
import math
import re
import shutil
import subprocess
import sys
from importlib import resources
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, TypeAdapter

from .paths import home
from .store import Store
from .ui import muted, success

# What must never reach ~/.lore/node from a dev checkout. The wheel itself
# ships only the files pyproject.toml's package-data names, so that list is
# the single manifest of what deploys.
EXCLUDED = ("node_modules", ".wrangler", ".buyer.env", ".dev.vars", "*.log")
WALLET = re.compile(r"0x[0-9a-fA-F]{40}")
D1_NAME = "lore-publications"
D1_PLACEHOLDER = "REPLACE_WITH_YOUR_D1_ID"
NEEDS_NODE = "deploying needs Node.js; install it from nodejs.org and rerun"
PRICE_DECLARATION = "export const PRICE_USD = 0.01;"
SALES_QUERY = (
    "SELECT kind, item_id, title, price_usd, network, payer, tx, sold_at "
    "FROM sales ORDER BY sold_at DESC, id DESC"
)


class Sale(BaseModel):
    """One settled paid call, as the node's ledger records it."""

    kind: Literal["publication", "answer"]
    item_id: str
    title: str
    price_usd: float
    network: str
    payer: str
    tx: str
    sold_at: str


SALES = TypeAdapter(list[Sale])
# The smallest price the six-decimal formatter can render without collapsing
# to zero; `lore price` rounds to six decimals, so this matches its floor.
MINIMUM_PRICE = 1e-6


def _refuse_dev_source_drift(packaged: Path) -> None:
    """Stop an installed CLI from ignoring edits in the current checkout."""
    for root in (Path.cwd(), *Path.cwd().parents):
        checkout = root / "lore/node"
        project = root / "pyproject.toml"
        if not checkout.is_dir() or not project.is_file():
            continue
        if 'name = "lore-mcp"' not in project.read_text():
            continue
        if packaged.resolve() == checkout.resolve():
            return
        if any(
            not (other := checkout / source.relative_to(packaged)).is_file()
            or source.read_bytes() != other.read_bytes()
            for source in packaged.rglob("*")
            if source.is_file()
        ):
            raise OSError(
                "installed Lore CLI differs from this checkout; deploy stopped "
                f"before using stale code. From {root}, run "
                "`uv tool install --force --reinstall .`, then rerun `lore node deploy`."
            )
        return


def materialize(price_usd: float) -> Path:
    """Copy the packaged Worker source to ~/.lore/node, never touching secrets.

    Re-running overwrites the source files (that is the upgrade path); files
    the owner created (`.buyer.env`, `.dev.vars`) stay untouched.
    """
    target = home() / "node"
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    # The owner pastes their D1 database_id into wrangler.jsonc after
    # `wrangler d1 create`; an upgrade must not reset it to the placeholder.
    config = target / "wrangler.jsonc"
    existing_id = None
    if config.is_file():
        match = re.search(r'"database_id":\s*"([^"]+)"', config.read_text())
        if match and match.group(1) != D1_PLACEHOLDER:
            existing_id = match.group(1)
    with resources.as_file(resources.files("lore") / "node") as source_dir:
        _refuse_dev_source_drift(source_dir)
        shutil.copytree(
            source_dir,
            target,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns(*EXCLUDED),
        )
    price_file = target / "src/price.ts"
    source = price_file.read_text()
    if PRICE_DECLARATION not in source:
        raise OSError(f"could not configure the node price in {price_file}")
    price = f"{price_usd:.6f}".rstrip("0").rstrip(".")
    price_file.write_text(
        source.replace(PRICE_DECLARATION, f"export const PRICE_USD = {price};")
    )
    if existing_id:
        config.write_text(config.read_text().replace(D1_PLACEHOLDER, existing_id))
    # Owner-only, like the rest of ~/.lore — after copytree, which copystats
    # the package directory's world-readable mode onto the target.
    target.chmod(0o700)
    return target


def _run(
    args: tuple[str, ...],
    cwd: Path,
    *,
    fail: str | None = None,
    interactive: bool = False,
    input: str | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        args, cwd=cwd, input=input, capture_output=not interactive, text=True
    )
    if fail is not None and result.returncode:
        detail = f"{result.stderr or ''}{result.stdout or ''}".strip()[-2000:]
        raise OSError(f"{fail}:\n{detail}")
    return result


def _ensure_d1(wrangler: str, target: Path) -> None:
    """Resolve the shipped database_id placeholder against the owner's account.

    Wrangler validates D1 bindings at deploy time, so the placeholder must
    become a real id first. Idempotent: if the database already exists (a
    re-materialize reset the config, say), its id is recovered via `d1 list`.
    """
    config = target / "wrangler.jsonc"
    text = config.read_text()
    if D1_PLACEHOLDER not in text:
        return
    muted("Creating the publications database (one-time)...")
    created = _run((wrangler, "d1", "create", D1_NAME), target)
    output = f"{created.stdout or ''}{created.stderr or ''}"
    if created.returncode and "already exists" not in output.lower():
        raise OSError(f"creating the D1 database failed:\n{output.strip()[-2000:]}")
    # `d1 create` prints a config snippet; the id format survives wrangler's
    # TOML-vs-JSON output changes, so match the value rather than the syntax.
    match = re.search(r'database_id[":\s=]+([0-9a-fA-F-]{32,36})', output)
    database_id = match.group(1) if match else None
    if database_id is None:
        listing = _run((wrangler, "d1", "list", "--json"), target)
        try:
            entries = json.loads(listing.stdout or "[]")
        except ValueError:
            entries = []
        database_id = next(
            (e.get("uuid") for e in entries if e.get("name") == D1_NAME), None
        )
    if not database_id:
        raise OSError(
            f"could not determine the {D1_NAME} database id; run "
            f"`npx wrangler d1 list` in {target} and paste it into wrangler.jsonc"
        )
    config.write_text(text.replace(D1_PLACEHOLDER, database_id))


def login() -> int:
    """Sign in to Cloudflare from the owner's browser.

    Prints the link to open (the desktop app opens it itself), waits for
    Cloudflare's callback, then says who is signed in."""
    if not shutil.which("npm"):
        raise OSError(NEEDS_NODE)
    target = home() / "node"
    if not (target / "package.json").exists():
        target = materialize(0.0)
    wrangler = target / "node_modules/.bin/wrangler"
    if not wrangler.exists():
        muted("Installing dependencies (the first run can take a minute)...")
        _run(
            ("npm", "install", "--no-fund", "--no-audit"),
            target,
            fail="npm install failed",
        )
    sys.stdout.flush()
    _run((str(wrangler), "login", "--browser=false"), target, interactive=True)
    # An interrupted login still exits 0; only whoami knows whether it landed.
    who = _run((str(wrangler), "whoami"), target)
    if who.returncode or "not authenticated" in f"{who.stdout}{who.stderr}".lower():
        raise OSError("Cloudflare sign-in did not complete")
    email = re.search(r"associated with the email (\S+)", who.stdout or "")
    success(f"Signed in to Cloudflare as {email.group(1) if email else 'your account'}")
    return 0


def sales() -> list[Sale]:
    """Read the node's sales ledger through the owner's Cloudflare login,
    the same way `lore push` writes the edge database."""
    target = home() / "node"
    wrangler = target / "node_modules/.bin/wrangler"
    if not wrangler.exists():
        raise ValueError("no deployed node on this machine; open your store first")
    result = _run(
        (
            str(wrangler),
            "d1",
            "execute",
            D1_NAME,
            "--remote",
            "--json",
            "--command",
            SALES_QUERY,
        ),
        target,
        fail="reading sales failed",
    )
    statements = json.loads(result.stdout)
    return SALES.validate_python(statements[0]["results"])


def deploy(wallet: str | None) -> int:
    """Materialize, authenticate, ensure D1, deploy, set the payout secret,
    push the active publications, smoke-check."""
    if wallet and not WALLET.fullmatch(wallet):
        raise ValueError(
            "wallet must be a public EVM address: 0x plus 40 hex characters"
        )
    if not shutil.which("npm"):
        raise OSError(NEEDS_NODE)

    with Store() as store:
        configured_price = store.setting("price_usd", None)
    if configured_price is None:
        raise ValueError(
            "no publication price is set; set one with `lore price <USD>` before deploying"
        )
    if isinstance(configured_price, bool) or not isinstance(
        configured_price, (int, float)
    ):
        raise ValueError(
            f"the publication price must be a number of at least ${MINIMUM_PRICE:.6f}; "
            "set it with `lore price <USD>` and rerun"
        )
    if not math.isfinite(configured_price):
        raise ValueError(
            f"the publication price must be a number of at least ${MINIMUM_PRICE:.6f}; "
            "set it with `lore price <USD>` and rerun"
        )
    if configured_price == 0:
        raise ValueError(
            "publications are free (`lore price 0`), which needs no deployed node; "
            "set a positive price with `lore price <USD>` to deploy, or stop here"
        )
    # The floor keeps the guard and the price formatter in agreement: anything
    # below 1e-6 renders as `PRICE_USD = 0`, a paid node that charges nothing.
    if configured_price < MINIMUM_PRICE:
        raise ValueError(
            f"the publication price must be a number of at least ${MINIMUM_PRICE:.6f}; "
            "set it with `lore price <USD>` and rerun"
        )

    target = materialize(float(configured_price))
    muted(f"Node source staged at {target}")
    muted("Installing dependencies (the first run can take a minute)...")
    _run(
        ("npm", "install", "--no-fund", "--no-audit"), target, fail="npm install failed"
    )
    wrangler = str(target / "node_modules/.bin/wrangler")

    # Some wrangler versions exit 0 while logged out and only say so in text.
    who = _run((wrangler, "whoami"), target)
    if who.returncode or "not authenticated" in f"{who.stdout}{who.stderr}".lower():
        muted("Opening Cloudflare login in your browser (free tier is enough)...")
        if _run((wrangler, "login"), target, interactive=True).returncode:
            raise OSError(
                f"Cloudflare login failed; run `npx wrangler login` in {target}"
            )

    if not wallet:
        # The Worker fails closed without LORE_WALLET regardless; this check
        # exists purely so a missing payout address costs seconds, not a deploy.
        listing = _run((wrangler, "secret", "list"), target)
        if "LORE_WALLET" not in (listing.stdout or ""):
            raise ValueError(
                "the node has no payout address; rerun with --wallet 0x<your public address>"
            )

    _ensure_d1(wrangler, target)
    deployed = _run((wrangler, "deploy"), target, fail="deploy failed")
    print(deployed.stdout.strip())

    # Wrangler colourises under TTY-ish environments; strip escapes so \S+
    # cannot swallow them into the matched address.
    plain = re.sub(r"\x1b\[[0-9;]*m", "", deployed.stdout)
    match = re.search(r"https://\S+\.workers\.dev", plain)
    url = match.group(0).rstrip("/") + "/mcp" if match else None
    if url:
        # Recorded before the secret put: if that step fails, the node is
        # live and `lore status` must still be able to recover it.
        with Store() as store:
            store.set_setting("node_url", url)

    if wallet:
        # Setting a secret redeploys, so the smoke check below sees a
        # configured node even on the very first deploy.
        _run(
            (wrangler, "secret", "put", "LORE_WALLET"),
            target,
            input=wallet + "\n",
            fail="setting LORE_WALLET failed",
        )

    # First push creates the publications table (CREATE TABLE IF NOT EXISTS),
    # so discover works before the owner has published anything; an empty
    # active set is a valid state, and re-pushing is idempotent.
    from .cli import push  # local import: cli imports this module at top level

    push(str(target))

    if not url:
        # The deploy succeeded, so no workers.dev address in the output means
        # a custom route, not a dead node — the recorded URL stays as it was.
        muted(
            "Deployed, but wrangler printed no workers.dev URL (custom route?); "
            "kept the recorded node URL — smoke-check manually."
        )
        return 0

    smoke = _run(("npm", "run", "smoke", "--", url), target)
    if smoke.returncode:
        raise OSError(
            f"deployed, but the smoke check failed against {url}:\n"
            f"{(smoke.stderr or smoke.stdout).strip()[-2000:]}\n"
            f"Stream the live error with `npx wrangler tail` in {target}"
        )
    success(f"Live and smoke-checked: {url}")
    return 0
