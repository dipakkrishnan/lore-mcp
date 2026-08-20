"""`lore.mcp.TOOLS` against the cross-surface contract (MCP-002).

The Cloudflare Worker (`lore/node/src/index.ts`) declares its own copy of each
tool's name, description, and required arguments — nothing keeps the two
surfaces in agreement short of a human re-reading both files. This test and
its Node counterpart (`lore/node/test/mcp-contract.test.ts`) each check their
own surface against the same checked-in `contracts/mcp_tools.json`: a tool
added, renamed, or reworded on either side without updating that file fails
here or there, whichever surface drifted.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from lore.mcp import TOOLS

CONTRACT_PATH = Path(__file__).resolve().parent.parent / "contracts" / "mcp_tools.json"


class MCPContractTest(unittest.TestCase):
    def test_tools_match_the_shared_contract(self) -> None:
        # Entries may scope themselves to one surface (the answer tier is
        # worker-only); an entry without `surfaces` is shared by both.
        canonical = [
            {key: entry[key] for key in ("name", "description", "required")}
            for entry in json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
            if "stdio" in entry.get("surfaces", ["stdio", "worker"])
        ]
        actual = sorted(
            (
                {
                    "name": tool["name"],
                    "description": tool["description"],
                    "required": sorted(tool["inputSchema"].get("required", [])),
                }
                for tool in TOOLS
            ),
            key=lambda item: item["name"],
        )
        self.assertEqual(actual, canonical)


if __name__ == "__main__":
    unittest.main()
