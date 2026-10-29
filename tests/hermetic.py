"""No test may reach a real Cloudflare account (XC-069).

Every command Lore runs (npm, npx, wrangler) goes through `lore.deploy`'s
`subprocess.run`. Imported once per test process, by `helpers.py`, by
`conftest.py` for pytest, and by every test file that doesn't use helpers,
this module makes that call refuse unless a test stubbed it, and points
wrangler and npm at nothing they could sign in or download with, in this
process and in any `lore` a test starts.
"""

from __future__ import annotations

import os
import subprocess
import tempfile
import urllib.request
from pathlib import Path
from typing import Any

import lore.cloudflare
import lore.deploy

_SANDBOX = Path(tempfile.mkdtemp(prefix="lore-tests-"))
(_SANDBOX / "npmrc").write_text("", encoding="utf-8")

# A token wrangler uses ahead of any login it finds, and that Cloudflare refuses;
# its own config and npm's under a throwaway directory, and npm never online.
ENVIRONMENT = {
    "CLOUDFLARE_API_TOKEN": "invalid-for-tests",
    "CLOUDFLARE_ACCOUNT_ID": "0" * 32,
    "WRANGLER_HOME": str(_SANDBOX / "wrangler"),
    "XDG_CONFIG_HOME": str(_SANDBOX / "config"),
    "WRANGLER_SEND_METRICS": "false",
    "npm_config_userconfig": str(_SANDBOX / "npmrc"),
    "npm_config_cache": str(_SANDBOX / "npm-cache"),
    "npm_config_offline": "true",
}
os.environ.update(ENVIRONMENT)

_REAL_RUN = subprocess.run
REFUSAL = "tests must not run wrangler/npm"


class _Commands:
    """`subprocess` as `lore.deploy` sees it: `run` refuses unless stubbed.

    A test stubs it either way the suite already does: patching
    `lore.deploy.subprocess.run` replaces `run` here, and patching
    `subprocess.run` is what `run` then calls."""

    def __getattr__(self, name: str) -> Any:
        return getattr(subprocess, name)

    def run(self, *args: Any, **kwargs: Any) -> Any:
        if subprocess.run is _REAL_RUN:
            command = args[0] if args else kwargs.get("args")
            raise AssertionError(f"{REFUSAL}: {command}")
        return subprocess.run(*args, **kwargs)


class _Requests:
    """`urllib.request` as `lore.cloudflare` sees it: Cloudflare's API refuses
    unless a test patched `lore.cloudflare.request.urlopen` (XC-087)."""

    def __getattr__(self, name: str) -> Any:
        return getattr(urllib.request, name)

    def urlopen(self, call: Any, *args: Any, **kwargs: Any) -> Any:
        raise AssertionError(f"tests must not call Cloudflare's API: {call.full_url}")


if type(lore.deploy.subprocess).__name__ != "_Commands":
    lore.deploy.subprocess = _Commands()  # type: ignore[assignment]
if type(lore.cloudflare.request).__name__ != "_Requests":
    lore.cloudflare.request = _Requests()  # type: ignore[assignment]
