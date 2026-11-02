from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from io import StringIO
from pathlib import Path
from unittest.mock import patch

from helpers import LoreTestCase, captured

from lore import bids, cli
from lore.bids import BidMatcher, OpenBid, stems
from lore.store import Status, Store

FIXTURES = Path(__file__).parent / "fixtures" / "bids"
NOW = datetime(2026, 11, 1, tzinfo=timezone.utc)


def board() -> list[dict]:
    return json.loads((FIXTURES / "bids.json").read_text(encoding="utf-8"))["bids"]


class BidMatchTest(LoreTestCase):
    def setUp(self) -> None:
        super().setUp()
        with Store() as store:
            for memory in json.loads(
                (FIXTURES / "library.json").read_text(encoding="utf-8")
            ):
                store.put(
                    source="test",
                    origin="native",
                    source_path=memory["title"],
                    source_key=memory["title"],
                    fingerprint=memory["title"],
                    title=memory["title"],
                    content=memory["content"],
                )

    def scores(self) -> dict[str, float]:
        """Every bid's best score with no line drawn, so the corpus shows where the gap is."""
        with patch.object(bids, "THRESHOLD", 0.0), Store() as store:
            matcher = BidMatcher(store, NOW)
            found = {
                bid["id"]: matcher.match(OpenBid.model_validate(bid)) for bid in board()
            }
        return {bid: match["score"] if match else 0.0 for bid, match in found.items()}

    def test_the_line_separates_every_answerable_bid_from_every_other(self) -> None:
        scores = self.scores()
        answerable = [scores[bid["id"]] for bid in board() if bid["answerable"]]
        others = [scores[bid["id"]] for bid in board() if not bid["answerable"]]
        self.assertGreaterEqual(min(answerable), bids.THRESHOLD + 0.1)
        self.assertLessEqual(max(others), bids.THRESHOLD - 0.1)

    def test_a_match_names_the_memories_that_answer_and_nothing_else(self) -> None:
        with Store() as store:
            found = BidMatcher(store, NOW).matches(
                [OpenBid.model_validate(bid) for bid in board()]
            )
        self.assertEqual(
            {match["bid"]["id"] for match in found},
            {bid["id"] for bid in board() if bid["answerable"]},
        )
        hacking = next(match for match in found if match["bid"]["id"] == "aaaaaaaaa1")
        self.assertEqual(
            hacking["memories"][0]["title"], "Reward hacking on long coding tasks"
        )
        self.assertLessEqual(len(hacking["memories"]), bids.TOP)
        self.assertEqual(set(hacking["memories"][0]), {"id", "title"})
        self.assertEqual(
            set(hacking["bid"]), {"id", "question", "usd", "market", "url", "expires"}
        )
        self.assertEqual(
            [m["score"] for m in found],
            sorted((m["score"] for m in found), reverse=True),
        )

    def test_bids_that_have_ended_are_never_matched(self) -> None:
        live = board()[0]
        ended = [
            live | {"status": "filled"},
            live | {"status": "removed"},
            live | {"expires": "2026-10-31T00:00:00Z"},
        ]
        with Store() as store:
            matcher = BidMatcher(store, NOW)
            self.assertEqual(
                matcher.matches([OpenBid.model_validate(bid) for bid in ended]), []
            )
            self.assertEqual(
                len(
                    matcher.matches(
                        [OpenBid.model_validate(live | {"status": "answered"})]
                    )
                ),
                1,
            )

    def test_only_kept_memories_answer(self) -> None:
        with Store() as store:
            [memory] = [
                m
                for m in store.search("reward hacking long coding")
                if m.title.startswith("Reward")
            ]
            store.set_status(memory.id, Status.DISCARDED.value)
            found = BidMatcher(store, NOW).match(OpenBid.model_validate(board()[0]))
        self.assertNotIn(
            memory.id, [m["id"] for m in (found or {"memories": []})["memories"]]
        )

    def test_a_question_of_only_small_words_matches_nothing(self) -> None:
        with Store() as store:
            question = board()[0] | {"question": "How do you do it, and why?"}
            self.assertIsNone(
                BidMatcher(store, NOW).match(OpenBid.model_validate(question))
            )

    def test_the_command_reads_the_board_on_stdin_and_skips_what_it_cannot_read(
        self,
    ) -> None:
        sent = json.dumps({"bids": [{"id": "nope"}, *board()], "walked_away": 0})
        with patch.object(sys, "stdin", StringIO(sent)), captured() as out:
            self.assertEqual(cli.main(["bids", "match"]), 0)
        found = json.loads(out.getvalue())
        self.assertEqual(len(found), sum(bid["answerable"] for bid in board()))


class StemsTest(LoreTestCase):
    def test_words_that_carry_meaning_are_kept_as_prefixes(self) -> None:
        self.assertEqual(
            stems("How do you stop reward-hacking on long coding tasks?"),
            ["stop", "reward", "hack", "long", "coding", "task"],
        )
        self.assertEqual(stems("Which policies, policy?"), ["polic", "policy"])
        self.assertEqual(stems("the and of"), [])
