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


class LibraryCase(LoreTestCase):
    """The fixture library, kept."""

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


class BidMatchTest(LibraryCase):
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
        self.assertGreaterEqual(min(answerable), bids.THRESHOLD + 0.05)
        self.assertLessEqual(max(others), bids.THRESHOLD - 0.1)

    def test_every_named_memory_answers_the_bid_and_every_answer_is_named(
        self,
    ) -> None:
        """Precision and recall on the corpus, distractors included: task groups,
        project logs and a weekly review that brush the question's words."""
        with Store() as store:
            matcher = BidMatcher(store, NOW)
            for bid in board():
                found = matcher.match(OpenBid.model_validate(bid))
                titles = [m["title"] for m in (found or {"memories": []})["memories"]]
                with self.subTest(bid=bid["id"]):
                    self.assertTrue(set(titles) <= set(bid["answers"]), titles)
                    self.assertEqual(bool(titles), bid["answerable"])

    def test_a_memory_far_behind_the_best_is_not_named(self) -> None:
        sizing = next(bid for bid in board() if bid["id"] == "ccccccccc1")
        with patch.object(bids, "THRESHOLD", 0.2), Store() as store:
            found = BidMatcher(store, NOW).match(OpenBid.model_validate(sizing))
        assert found is not None
        self.assertEqual(
            [m["title"] for m in found["memories"]], ["Sizing GLM 5.3 Flash on B300s"]
        )

    def test_the_label_is_strong_only_when_the_best_memory_is(self) -> None:
        with Store() as store:
            matcher = BidMatcher(store, NOW)
            labels = {
                bid["id"]: match["strength"]
                for bid in board()
                if (match := matcher.match(OpenBid.model_validate(bid)))
            }
        self.assertEqual(labels["ccccccccc1"], "strong")
        self.assertEqual(labels["aaaaaaaaa2"], "good")

    def test_a_one_word_question_is_scored_on_that_word(self) -> None:
        with Store() as store:
            found = BidMatcher(store, NOW).match(
                OpenBid.model_validate(board()[0] | {"question": "Sourdough?"})
            )
        assert found is not None
        self.assertEqual(
            [m["title"] for m in found["memories"]],
            ["Sourdough starter in a cold kitchen"],
        )

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
            ["stop", "reward", "hack", "long", "cod", "task"],
        )
        self.assertEqual(stems("Which policies, policy?"), ["polic"])
        self.assertEqual(
            stems("GLM 5.3 on B300s and GPUs"), ["glm", "5.3", "b300", "gpu"]
        )
        self.assertEqual(stems("serve, serving, served"), ["serv"])
        self.assertEqual(stems("the and of"), [])


class BoundsTest(LibraryCase):
    def run_match(self, sent: str) -> list[dict]:
        with patch.object(sys, "stdin", StringIO(sent)), captured() as out:
            self.assertEqual(cli.main(["bids", "match"]), 0)
        return json.loads(out.getvalue())

    def test_a_question_past_the_contract_s_length_is_never_matched(self) -> None:
        long = board()[0] | {"question": board()[0]["question"] + " x" * 200}
        self.assertEqual(self.run_match(json.dumps({"bids": [long]})), [])

    def test_only_the_first_bids_up_to_the_cap_are_read(self) -> None:
        filler = [board()[9] | {"id": f"f{n:09d}"} for n in range(bids.BIDS_AT_MOST)]
        found = self.run_match(json.dumps({"bids": [*filler, board()[0]]}))
        self.assertEqual(found, [])

    def test_a_board_past_the_byte_cap_is_refused(self) -> None:
        sent = json.dumps({"bids": board()})
        with (
            patch.object(bids, "BOARD_BYTES", 10),
            patch.object(sys, "stdin", StringIO(sent)),
        ):
            with self.assertRaisesRegex(ValueError, "too big"):
                cli.bids_match()

    def test_only_so_many_words_are_searched(self) -> None:
        words = " ".join(f"word{n}" for n in range(40))
        self.assertEqual(len(stems(words)), bids.TERMS_AT_MOST)
