"""Which open bids the owner's memories can answer, decided on this Mac (APP-274).

The app reads yourlore.dev's public `/bids.json` and hands it over; nothing here
touches the network. A match names memories by id and title only, for the owner.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone
from itertools import pairwise

from pydantic import BaseModel, ConfigDict, Field

from .store import BID_ID, Store

# Each memory is scored on its own: the share of what the question is about
# that it holds, each word weighted by how rare it is in the library, with
# credit for holding the question's words side by side. A memory is named only
# when its own score clears THRESHOLD and comes within NEAR of the best one's, so a
# long log that brushes a few of the question's words is never handed to the
# drafting model. Chosen on the corpus in tests/fixtures/bids, where every
# answerable bid's answer scores 0.56 or more and no other memory, distractors
# included, reaches 0.4 (tests/test_bids.py holds both lines).
THRESHOLD = 0.5
NEAR = 0.8
# A bid whose best memory scores this much is labelled strong, otherwise good.
STRONG = 0.75
# How much of a memory's score comes from words it holds side by side.
PAIRED = 0.25
# A memory sharing one word with the question is a coincidence, not an answer.
SHARED = 2
# The most memories one match names, and how many the search reads to find them.
TOP = 3
READ = 20
# The board is public, so what is read of it is bounded: bytes, bids, and a
# question's length as contracts/bids.md caps it, and the words searched for.
BOARD_BYTES = 1_000_000
BIDS_AT_MOST = 200
QUESTION_AT_MOST = 280
TERMS_AT_MOST = 16

WORD = re.compile(r"[^\W_]+(?:\.\d+)*")
SUFFIXES = ("ies", "ing", "ed", "es", "s")
# Words that say how a question is asked, never what it is about.
STOPWORDS = frozenset(
    """a about above after again against all am an and any are as at be because been before being below
    best between both but by can could did do does doing done down during each few for from further get
    gets getting got had has have having he her here hers how i if in into is it its just keep keeps know
    like make makes me more most much my no nor not now of off on once only or other our out over own
    really right same she should so some still such than that the their them then there these they this
    those through to too under until up us very was way ways we were what when where which while who whom
    why will with without would you your yours actually anyone anybody someone something thing things
    tips good better work works working use using used want need try trying new many take takes""".split()
)
# Words that name how a note is filed, not what it knows: task groups, project
# logs and dated reviews are full of them, so they count for little.
GENERIC = frozenset(
    """project task group lore log note review weekly daily plan goal list update status""".split()
)
GENERIC_WEIGHT = 0.25
YEAR = re.compile(r"(19|20)\d\d")


class OpenBid(BaseModel):
    """A bid as `/bids.json` shows it (contracts/bids.md); the rest of its fields are not needed here."""

    model_config = ConfigDict(extra="ignore", frozen=True)

    id: str = Field(pattern=BID_ID, min_length=10)
    question: str = Field(min_length=1, max_length=QUESTION_AT_MOST)
    usd: float
    market: str = ""
    url: str = ""
    status: str = "open"
    expires: str

    def live(self, now: datetime) -> bool:
        """Still taking answers: open or answered, and inside its week."""
        ends = datetime.fromisoformat(self.expires.replace("Z", "+00:00"))
        return self.status in ("open", "answered") and ends > now


def stem(word: str) -> str:
    """A word cut to what its forms share, so plurals, -ing and -ed forms, and a final e or y meet."""
    for suffix in SUFFIXES:
        if word.endswith(suffix) and not word.endswith("ss"):
            if len(word) - len(suffix) >= 3:
                word = word[: -len(suffix)]
                break
    return word[:-1] if len(word) > 3 and word[-1] in "ey" else word


def words(text: str) -> list[str]:
    """The words of `text` that carry meaning, cut to their stems, in order."""
    return [
        stem(word)
        for word in WORD.findall(text.lower())
        if word not in STOPWORDS and len(word) >= 2
    ]


def stems(text: str) -> list[str]:
    """The question's words that carry meaning, once each, in the order asked."""
    return list(dict.fromkeys(words(text)))[:TERMS_AT_MOST]


class BidMatcher:
    """Scores each open bid against the owner's kept memories with the library's own search."""

    def __init__(self, store: Store, now: datetime | None = None) -> None:
        self.store = store
        self.now = now or datetime.now(timezone.utc)
        self.size = store.counts()["private"]

    def weights(self, terms: list[str]) -> dict[str, float]:
        """Rare words say more about what is asked than common ones; a word no memory holds weighs most."""
        held = self.store.holding(terms)
        return {
            term: math.log((self.size + 1) / (held[term] + 0.5))
            * (GENERIC_WEIGHT if term in GENERIC or YEAR.fullmatch(term) else 1)
            for term in terms
        }

    @staticmethod
    def score(terms: list[str], weights: dict[str, float], text: str) -> float:
        """How much of the question one memory holds: its words, and its pairs of words side by side."""
        held = words(text)
        shared = set(terms) & set(held)
        if len(shared) < min(SHARED, len(terms)):
            return 0.0
        alone = sum(weights[term] for term in shared) / sum(weights.values())
        pairs = list(pairwise(terms))
        if not pairs:
            return alone
        beside = set(pairwise(held))
        together = sum(weights[a] + weights[b] for a, b in pairs if (a, b) in beside)
        return (1 - PAIRED) * alone + PAIRED * together / sum(
            weights[a] + weights[b] for a, b in pairs
        )

    def match(self, bid: OpenBid) -> dict | None:
        """The memories that each answer `bid` on their own, best first, or None when none does."""
        terms = stems(bid.question)
        if not terms:
            return None
        weights = self.weights(terms)
        scored = sorted(
            (
                (self.score(terms, weights, f"{memory.title} {memory.content}"), memory)
                for memory in self.store.search(
                    " ".join(terms), status="private", limit=READ, loose=True
                )
            ),
            key=lambda pair: -pair[0],
        )
        if not scored or scored[0][0] < THRESHOLD:
            return None
        best = scored[0][0]
        picked = [
            memory
            for score, memory in scored[:TOP]
            if score >= THRESHOLD and score >= NEAR * best
        ]
        return {
            "bid": bid.model_dump(
                include={"id", "question", "usd", "market", "url", "expires"}
            ),
            "memories": [{"id": memory.id, "title": memory.title} for memory in picked],
            "score": round(best, 3),
            "strength": "strong" if best >= STRONG else "good",
        }

    def matches(self, bids: list[OpenBid]) -> list[dict]:
        """Strong matches among the live bids, best first."""
        live = [bid for bid in bids if bid.live(self.now)]
        found = [match for bid in live if (match := self.match(bid))]
        return sorted(found, key=lambda match: -match["score"])
