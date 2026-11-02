"""Which open bids the owner's memories can answer, decided on this Mac (APP-274).

The app reads yourlore.dev's public `/bids.json` and hands it over; nothing here
touches the network. A match names memories by id and title only, for the owner.
"""

from __future__ import annotations

import math
import re
from datetime import datetime, timezone

from pydantic import BaseModel, ConfigDict, Field

from .store import BID_ID, Store

# A match is strong when the memories hold this share of what the question is
# about, each word weighted by how rare it is in the library. Chosen on the
# corpus in tests/fixtures/bids: every answerable bid there scores 0.62 or
# more and every other bid, near misses included, 0.31 or less; the line sits
# in that gap (tests/test_bids.py holds it).
THRESHOLD = 0.5
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

WORD = re.compile(r"[^\W_]+")
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
    tips good better work works working use using used want need try trying new""".split()
)


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


def stems(text: str) -> list[str]:
    """The question's words that carry meaning, each cut to a prefix so plurals and -ing forms still meet."""
    found: list[str] = []
    for word in WORD.findall(text.lower()):
        if word in STOPWORDS or len(word) < 2:
            continue
        for suffix in SUFFIXES:
            if word.endswith(suffix) and len(word) - len(suffix) >= 4:
                word = word[: -len(suffix)]
                break
        if word not in found:
            found.append(word)
    return found[:TERMS_AT_MOST]


class BidMatcher:
    """Scores each open bid against the owner's kept memories with the library's own search."""

    def __init__(self, store: Store, now: datetime | None = None) -> None:
        self.store = store
        self.now = now or datetime.now(timezone.utc)
        self.size = store.counts()["private"]

    def weights(self, terms: list[str]) -> dict[str, float]:
        """Rare words say more about what is asked than common ones; a word no memory holds weighs most."""
        held = self.store.holding(terms)
        return {term: math.log((self.size + 1) / (held[term] + 0.5)) for term in terms}

    def match(self, bid: OpenBid) -> dict | None:
        """The memories that answer `bid`, with how much of it they cover, or None when they don't."""
        terms = stems(bid.question)
        if not terms:
            return None
        weights = self.weights(terms)
        whole = sum(weights.values())
        found = []
        for memory in self.store.search(
            " ".join(terms), status="private", limit=READ, loose=True
        ):
            words = WORD.findall(f"{memory.title} {memory.content}".lower())
            shared = {term for term in terms if any(w.startswith(term) for w in words)}
            if len(shared) >= min(SHARED, len(terms)):
                covered = sum(weights[term] for term in shared) / whole
                found.append((covered, memory))
        found.sort(key=lambda pair: -pair[0])
        if not found or found[0][0] < THRESHOLD:
            return None
        picked = [memory for covered, memory in found[:TOP] if covered >= THRESHOLD / 2]
        return {
            "bid": bid.model_dump(
                include={"id", "question", "usd", "market", "url", "expires"}
            ),
            "memories": [{"id": memory.id, "title": memory.title} for memory in picked],
            "score": round(found[0][0], 3),
        }

    def matches(self, bids: list[OpenBid]) -> list[dict]:
        """Strong matches among the live bids, best first."""
        live = [bid for bid in bids if bid.live(self.now)]
        found = [match for bid in live if (match := self.match(bid))]
        return sorted(found, key=lambda match: -match["score"])
