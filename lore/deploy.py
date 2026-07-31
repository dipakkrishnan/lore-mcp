"""Deploy the owner's Lore node to their own Cloudflare account.

The Worker source ships inside this package (`lore/node`), so deployment never
needs the git repository: `lore node deploy` materializes the source to
`~/.lore/node`, then drives npm and wrangler there. The Worker version always
matches the installed CLI version — the property that matters once `lore push`
and the Worker share a D1 schema (MON-003).
"""

from __future__ import annotations

import re
import shutil
import subprocess
from importlib import resources
from pathlib import Path

from .paths import home
from .store import Store
from .ui import muted, success

# What must never reach ~/.lore/node from a dev checkout. The wheel itself
# ships only the files pyproject.toml's package-data names, so that list is
# the single manifest of what deploys.
EXCLUDED = ("node_modules", ".wrangler", ".buyer.env", ".dev.vars", "*.log")
WALLET = re.compile(r"0x[0-9a-fA-F]{40}")


def materialize() -> Path:
    """Copy the packaged Worker source to ~/.lore/node, never touching secrets.

    Re-running overwrites the source files (that is the upgrade path); files
    the owner created (`.buyer.env`, `.dev.vars`) stay untouched.
    """
    target = home() / "node"
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    shutil.copytree(
        resources.files("lore") / "node",
        target,
        dirs_exist_ok=True,
        ignore=shutil.ignore_patterns(*EXCLUDED),
    )
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


def deploy(wallet: str | None) -> int:
    """Materialize, authenticate, deploy, set the payout secret, smoke-check."""
    if wallet and not WALLET.fullmatch(wallet):
        raise ValueError("wallet must be a public EVM address: 0x plus 40 hex characters")
    if not shutil.which("npm"):
        raise OSError("deploying needs Node.js; install it from nodejs.org and rerun")

    target = materialize()
    muted(f"Node source staged at {target}")
    muted("Installing dependencies (the first run can take a minute)...")
    _run(("npm", "install", "--no-fund", "--no-audit"), target, fail="npm install failed")
    wrangler = str(target / "node_modules/.bin/wrangler")

    # Some wrangler versions exit 0 while logged out and only say so in text.
    who = _run((wrangler, "whoami"), target)
    if who.returncode or "not authenticated" in f"{who.stdout}{who.stderr}".lower():
        muted("Opening Cloudflare login in your browser (free tier is enough)...")
        if _run((wrangler, "login"), target, interactive=True).returncode:
            raise OSError(f"Cloudflare login failed; run `npx wrangler login` in {target}")

    if not wallet:
        # The Worker fails closed without LORE_WALLET regardless; this check
        # exists purely so a missing payout address costs seconds, not a deploy.
        listing = _run((wrangler, "secret", "list"), target)
        if "LORE_WALLET" not in (listing.stdout or ""):
            raise ValueError(
                "the node has no payout address; rerun with --wallet 0x<your public address>"
            )

    deployed = _run((wrangler, "deploy"), target, fail="deploy failed")
    print(deployed.stdout.strip())
    if wallet:
        # Setting a secret redeploys, so the smoke check below sees a
        # configured node even on the very first deploy.
        _run(
            (wrangler, "secret", "put", "LORE_WALLET"),
            target,
            input=wallet,
            fail="setting LORE_WALLET failed",
        )

    match = re.search(r"https://\S+\.workers\.dev", deployed.stdout)
    url = match.group(0).rstrip("/") + "/mcp" if match else None
    with Store() as store:
        # None clears a stale URL: a deploy that prints no address is exactly
        # the event that invalidates whatever was recorded before.
        store.set_setting("node_url", url)
    if not url:
        muted("Deployed, but wrangler printed no workers.dev URL; smoke-check manually.")
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
