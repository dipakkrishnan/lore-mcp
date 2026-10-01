"""A stand-in for Granola's server: its two tools, answering in its loose XML, with no
sign-in. Unit tests connect to it in-process; `python tests/fixtures/granola.py PORT`
serves it over HTTP for the desktop's edge scenario."""

from __future__ import annotations

import sys
from typing import Literal

from mcp.server.mcpserver import MCPServer

MEETINGS = {
    "m-1": (
        "Pricing review",
        "Jan 2, 2026 3:04 PM",
        "Raise the first tier only once ten buyers have paid; a receipt beats a survey.",
    ),
    "m-2": (
        "Hiring <> Ops sync",
        "Feb 10, 2026 9:30 AM",
        "Add the management layer before the next ten engineers join, not after.",
    ),
}


class Granola:
    def __init__(self, meetings: dict[str, tuple[str, str, str]] = MEETINGS) -> None:
        self.read: list[str] = []
        self.server = MCPServer("granola")

        @self.server.tool()
        def list_meetings(
            time_range: Literal[
                "this_week", "last_week", "last_30_days"
            ] = "last_30_days",
        ) -> str:
            rows = "".join(
                f'<meeting id="{key}" title="{title}" date="{when}"></meeting>'
                for key, (title, when, _) in meetings.items()
            )
            return f'<meetings_data count="{len(meetings)}">{rows}</meetings_data>'

        @self.server.tool()
        def get_meetings(meeting_ids: list[str]) -> str:
            self.read.extend(meeting_ids)
            return "".join(
                f'<meeting id="{key}" title="{meetings[key][0]}">'
                "<known_participants>Owner <owner@example.com></known_participants>"
                f"<private_notes>{meetings[key][2]}</private_notes>"
                "<summary>Agreed next steps.</summary></meeting>"
                for key in meeting_ids
            )


if __name__ == "__main__":
    Granola().server.run("streamable-http", host="127.0.0.1", port=int(sys.argv[1]))
