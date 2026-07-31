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

# Exactly what ships to the owner's machine. Explicit, so dev-checkout
# artifacts (node_modules, .wrangler, a real .buyer.env) can never ride along.
FILES = (
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "wrangler.jsonc",
    "env.d.ts",
    "README.md",
    ".buyer.env.example",
    ".dev.vars.example",
)
DIRS = ("src", "scripts")
WALLET = re.compile(r"0x[0-9a-fA-F]{40}")


def node_dir() -> Path:
    """Where the deployable node source lives on the owner's machine."""
    return home() / "node"


def materialize() -> Path:
    """Copy the packaged Worker source to ~/.lore/node, never touching secrets.

    Re-running overwrites the source files (that is the upgrade path) but a
    `.buyer.env` or `.dev.vars` the owner created stays untouched.
    """
    source = resources.files("lore") / "node"
    target = node_dir()
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    for name in FILES:
        (target / name).write_bytes((source / name).read_bytes())
    for directory in DIRS:
        (target / directory).mkdir(exist_ok=True)
        for item in (source / directory).iterdir():
            if item.name.endswith(".ts"):
                (target / directory / item.name).write_bytes(item.read_bytes())
    return target


def _run(
    args: tuple[str, ...], cwd: Path, *, interactive: bool = False, stdin: str | None = None
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        cwd=cwd,
        input=stdin,
        capture_output=not interactive,
        text=True,
    )


def deploy(wallet: str | None) -> int:
    """Materialize, authenticate, deploy, set the payout secret, smoke-check."""
    if wallet and not WALLET.fullmatch(wallet):
        raise ValueError("wallet must be a public EVM address: 0x plus 40 hex characters")
    if not shutil.which("npm"):
        raise OSError("deploying needs Node.js; install it from nodejs.org and rerun")

    target = materialize()
    print(f"Node source staged at {target}")
    install = _run(("npm", "install", "--no-fund", "--no-audit"), target)
    if install.returncode:
        raise OSError(f"npm install failed:\n{install.stderr.strip()[-2000:]}")

    if _run(("npx", "wrangler", "whoami"), target).returncode:
        print("Opening Cloudflare login in your browser (free tier is enough)...")
        if _run(("npx", "wrangler", "login"), target, interactive=True).returncode:
            raise OSError(f"Cloudflare login failed; run `npx wrangler login` in {target}")

    deployed = _run(("npx", "wrangler", "deploy"), target)
    print(deployed.stdout.strip())
    if deployed.returncode:
        raise OSError(f"deploy failed:\n{deployed.stderr.strip()[-2000:]}")

    if wallet:
        secret = _run(
            ("npx", "wrangler", "secret", "put", "LORE_WALLET"), target, stdin=wallet
        )
        if secret.returncode:
            raise OSError(f"setting LORE_WALLET failed:\n{secret.stderr.strip()[-2000:]}")
    else:
        listing = _run(("npx", "wrangler", "secret", "list"), target)
        if "LORE_WALLET" not in (listing.stdout or ""):
            raise ValueError(
                "the node has no payout address; rerun with --wallet 0x<your public address>"
            )

    match = re.search(r"https://\S+\.workers\.dev", deployed.stdout)
    if not match:
        print("Deployed, but wrangler printed no workers.dev URL; smoke-check manually.")
        return 0
    url = match.group(0).rstrip("/") + "/mcp"
    with Store() as store:
        store.set_setting("node_url", url)

    smoke = _run(("npm", "run", "smoke", "--", url), target)
    if smoke.returncode:
        raise OSError(
            f"deployed, but the smoke check failed against {url}:\n"
            f"{(smoke.stderr or smoke.stdout).strip()[-2000:]}\n"
            f"Stream the live error with `npx wrangler tail` in {target}"
        )
    print(f"Live and smoke-checked: {url}")
    return 0
