"""The store's `npm install`, run with the real npm, offline (XC-097).

Every other deploy test fakes the subprocess boundary (`tests/test_deploy.py`,
and `tests/hermetic.py` refuses a real npm or wrangler). This one runs npm on
purpose, with nothing to fetch, so it lives in the integration tier.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import unittest
from unittest.mock import patch

from helpers import LoreTestCase

from lore import deploy as deploy_module


class StoreInstallTest(LoreTestCase):
    @unittest.skipIf(shutil.which("npm") is None, "needs npm")
    def test_npm_settings_above_the_store_never_reach_its_install(self) -> None:
        # The worst case: a workspace root above the store with its own npm
        # settings, and an install script of the store's own. Real npm, offline:
        # the store has no dependencies to fetch.
        parent = self.store.parent
        marker = parent / "ran"
        planted = parent / "planted.cjs"
        planted.write_text(f"require('fs').writeFileSync({str(marker)!r}, 'options')")
        (parent / "package.json").write_text('{"workspaces": ["store"]}')
        (parent / ".npmrc").write_text(f"node-options=--require={planted}\n")
        self.store.mkdir()
        (self.store / "package.json").write_text(
            json.dumps(
                {
                    "name": "store",
                    "version": "1.0.0",
                    "scripts": {
                        "postinstall": f"node -e \"require('fs').writeFileSync({str(marker)!r}, 'script')\""
                    },
                }
            )
        )
        offline = {
            "npm_config_offline": "true",
            "npm_config_update_notifier": "false",
            "NO_UPDATE_NOTIFIER": "1",
        }
        # The fixture has no wrangler, so the install is not marked done either.
        # Real npm on purpose, past the hermetic guard: offline, with nothing to
        # fetch, it reaches no network and no account.
        with (
            patch.dict(os.environ, offline),
            patch("lore.deploy.subprocess.run", new=subprocess.run),
            self.assertRaisesRegex(OSError, "without wrangler"),
        ):
            deploy_module.install(self.store)
        self.assertFalse(marker.exists(), marker.read_text() if marker.exists() else "")
        self.assertFalse(deploy_module.installed(self.store))
