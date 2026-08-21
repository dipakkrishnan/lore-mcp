from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def executable(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    path.chmod(0o755)


class InstallTest(unittest.TestCase):
    def test_missing_uv_is_bootstrapped(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            tools = root / "tools"
            home = root / "home"
            tools.mkdir()
            home.mkdir()

            fake_uv = root / "uv"
            executable(
                fake_uv,
                "#!/bin/sh\n"
                'mkdir -p "$UV_TOOL_BIN_DIR"\n'
                "printf '#!/bin/sh\\nexit 0\\n' > \"$UV_TOOL_BIN_DIR/lore\"\n"
                'chmod +x "$UV_TOOL_BIN_DIR/lore"\n',
            )
            uv_installer = root / "install-uv.sh"
            executable(
                uv_installer,
                "#!/bin/sh\n"
                'mkdir -p "$HOME/.local/bin"\n'
                'cp "$FAKE_UV" "$HOME/.local/bin/uv"\n',
            )
            executable(tools / "curl", '#!/bin/sh\ncat "$FAKE_UV_INSTALLER"\n')
            executable(tools / "git", "#!/bin/sh\nexit 0\n")

            env = os.environ | {
                "PATH": f"{tools}{os.pathsep}{os.defpath}",
                "HOME": str(home),
                "LORE_SKIP_SETUP": "1",
                "LORE_SOURCE_DIR": str(ROOT),
                "LORE_INSTALL_DIR": str(root / "runtime"),
                "LORE_BIN_DIR": str(root / "bin"),
                "FAKE_UV": str(fake_uv),
                "FAKE_UV_INSTALLER": str(uv_installer),
            }
            result = subprocess.run(
                ["sh", str(ROOT / "install.sh")],
                capture_output=True,
                text=True,
                env=env,
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Installing uv...", result.stdout)
            self.assertEqual(
                subprocess.run([root / "bin/lore", "status"]).returncode, 0
            )
            expected = {
                path.name for path in (ROOT / "plugins/lore/skills").glob("lore-*")
            }
            for agent in (".agents", ".claude"):
                installed = {path.name for path in (home / agent / "skills").iterdir()}
                self.assertEqual(installed, expected)


if __name__ == "__main__":
    unittest.main()
