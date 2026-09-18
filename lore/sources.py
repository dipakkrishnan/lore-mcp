from __future__ import annotations

import hashlib
import json
import re
import urllib.request
import zipfile
from abc import ABC, abstractmethod
from dataclasses import replace
from datetime import date, datetime, timezone
from email.utils import parsedate_to_datetime
from enum import Enum
from functools import cached_property
from html.parser import HTMLParser
from pathlib import Path
from typing import ClassVar, Iterator, Literal
from urllib.parse import quote, urljoin, urlsplit
from xml.etree.ElementTree import Element, ParseError

from defusedxml.ElementTree import fromstring
from pydantic import (
    AliasChoices,
    AliasPath,
    BaseModel,
    Field,
    TypeAdapter,
    ValidationError,
    field_validator,
)
from pydantic.dataclasses import dataclass

from . import __version__
from .paths import claude_home, codex_home, home, obsidian_home
from .store import Store


class State(Enum):
    # The only green: a locator that merely resolves has not been read.
    CONNECTED = "connected"
    NOTHING_FOUND = "nothing_found"
    NEEDS_PERMISSION = "needs_permission"
    UNREACHABLE = "unreachable"
    OFF = "off"


class SourceError(ValueError):
    pass


@dataclass(frozen=True)
class Item:
    title: str
    content: str
    source_path: str
    dated: str | None
    excluded: bool = False
    key: str | None = None


@dataclass(frozen=True)
class Source:
    name: str
    label: str
    locator: str
    pattern: str = "**/*.md"
    origin: Literal["native", "automation"] = "native"
    kind: Literal["folder", "export", "feed"] = "folder"
    owned: bool = False
    since: str | None = None
    connector: str | None = None

    def reader(self) -> Reader:
        if self.connector:
            return Connector.named(self.connector).reader(self)
        # Every subclass is concrete; mypy cannot see that through __subclasses__.
        reader: type[Reader] = next(  # type: ignore[type-abstract]
            r for r in Reader.__subclasses__() if r.kind == self.kind
        )
        return reader(self)

    @classmethod
    def owner(
        cls,
        locator: str,
        label: str | None = None,
        since: str | None = None,
        kind: str = "folder",
        connector: str | None = None,
    ) -> Source:
        app = Connector.named(connector) if connector is not None else None
        if app is not None and app.reader.kind != kind:
            raise SourceError(f"{connector} reads a {app.reader.kind}, not a {kind}")
        try:
            source = cls(
                "",
                label or "",
                locator,
                kind=TypeAdapter(Literal["folder", "export", "feed"]).validate_python(
                    kind
                ),
                owned=True,
                since=_day(since),
                connector=connector,
            )
        except ValidationError as error:
            raise SourceError(str(error)) from None
        locator, default = source.reader().locate(locator)
        return replace(source, label=label or default, locator=locator)


class Reader(ABC):
    kind: ClassVar[Literal["folder", "export", "feed"]]
    # A place that keeps changing is read again on schedule; a file is read once.
    refresh: ClassVar[bool] = True
    # An owner's folder is arbitrary notes, not agent-written memory files: a
    # line shorter than a sentence is a heading or a stub, never a lesson.
    sentence = 40

    def __init__(self, source: Source) -> None:
        self.source = source
        self.label = source.label
        self.errors = 0
        self.failure: State | None = None

    @classmethod
    @abstractmethod
    def locate(cls, locator: str) -> tuple[str, str]:
        """Normalise what the owner typed into the source's identity and a default label."""

    @abstractmethod
    def probe(self) -> State:
        """Read the source and distinguish empty, inaccessible, and connected."""

    @abstractmethod
    def items(self) -> Iterator[Item]:
        """Yield source items, counting unreadable records in errors."""

    def name(self) -> str:
        """Every spelling of one place is one source, so the name digests the locator."""
        digest = hashlib.sha256(self.source.locator.encode()).hexdigest()[:8]
        return f"{self.source.connector or self.kind}-{digest}"

    def keeps(self, item: Item) -> bool:
        source = self.source
        if item.excluded:
            return False
        if not source.owned:
            return bool(item.content)
        return len(item.content) >= self.sentence and (
            source.since is None or item.dated is None or item.dated >= source.since
        )


class FolderReader(Reader):
    kind = "folder"
    # Vault plumbing and blank templates, which read as memories but are not.
    skipped = {".obsidian", ".trash", "templates"}
    frontmatter = re.compile(r"\A---\n(.*?)\n---", re.DOTALL)

    @classmethod
    def locate(cls, locator: str) -> tuple[str, str]:
        # Two spellings of one folder are one source, so the identity is the
        # resolved path rather than what the owner typed.
        root = Path(locator).expanduser().resolve()
        return str(root), root.name

    @cached_property
    def files(self) -> list[Path]:
        return sorted(
            path
            for path in Path(self.source.locator).glob(self.source.pattern)
            if path.is_file() and not path.is_symlink() and self._included(path)
        )

    def probe(self) -> State:
        root = Path(self.source.locator)
        if not root.is_dir():
            return State.UNREACHABLE
        try:
            # `glob` swallows a denied directory and returns nothing, so the
            # only way to tell "no permission" from "nothing there" is to ask.
            next(root.iterdir(), None)
        except PermissionError:
            return State.NEEDS_PERMISSION
        except OSError:
            return State.UNREACHABLE
        return State.CONNECTED if self.files else State.NOTHING_FOUND

    def items(self) -> Iterator[Item]:
        for path in self.files:
            try:
                content = path.read_text(encoding="utf-8").strip()
                item = Item(
                    _title(path, content),
                    content,
                    str(path),
                    self._dated(path, content),
                )
            except PermissionError:
                self.errors += 1
                self.failure = State.NEEDS_PERMISSION
                continue
            except (OSError, UnicodeError):
                self.errors += 1
                if self.failure is None:
                    self.failure = State.UNREACHABLE
                continue
            yield item

    def _included(self, path: Path) -> bool:
        if not self.source.owned:
            return not (self.source.origin == "automation" and path.name == "INDEX.md")
        parts = path.relative_to(Path(self.source.locator)).parts[:-1]
        return not any(part.lower() in self.skipped for part in parts)

    def _dated(self, path: Path, content: str) -> str | None:
        front = self.frontmatter.match(content)
        if front:
            for field in ("date", "created"):
                match = re.search(
                    rf"^{field}:\s*['\"]?(\d{{4}}-\d{{2}}-\d{{2}})",
                    front.group(1),
                    re.MULTILINE,
                )
                if match:
                    return match.group(1)
        return date.fromtimestamp(path.stat().st_mtime).isoformat()


class Choice(BaseModel):
    label: str
    locator: str
    open: bool = False


class App(BaseModel):
    """An app as the catalog offers it: enough for any surface to draw the row and the sheet."""

    id: str
    name: str
    what: str
    unit: str
    item: str
    kind: Literal["folder", "export", "feed"]
    refresh: bool
    placeholder: str = ""


class Connector:
    """An app the owner recognises, over the reader that does the work. Defining
    a subclass is the whole registration: it appears in the catalog, the CLI,
    and the desktop with no further wiring."""

    id: ClassVar[str]
    name: ClassVar[str]
    what: ClassVar[str]
    unit: ClassVar[str]
    item: ClassVar[str]
    reader: ClassVar[type[Reader]]
    placeholder: ClassVar[str] = ""

    @classmethod
    def named(cls, app: str) -> Connector:
        for connector in cls.__subclasses__():
            if connector.id == app:
                return connector()
        raise SourceError(f"unknown app: {app}")

    @classmethod
    def catalog(cls) -> list[App]:
        return [connector().app() for connector in cls.__subclasses__()]

    def app(self) -> App:
        return App(
            id=self.id,
            name=self.name,
            what=self.what,
            unit=self.unit,
            item=self.item,
            kind=self.reader.kind,
            refresh=self.reader.refresh,
            placeholder=self.placeholder,
        )

    def choices(self) -> list[Choice]:
        """What the owner picks among, found without asking them."""
        return []


class Vault(BaseModel):
    path: str
    open: bool = False


class Obsidian(Connector):
    """A vault is a plain folder; Obsidian keeps every vault's path in one file."""

    id = "obsidian"
    name = "Obsidian"
    what = "Your vaults and notes"
    unit = "vault"
    item = "note"
    reader = FolderReader

    class Vaults(BaseModel):
        vaults: dict[str, Vault] = {}

    def choices(self) -> list[Choice]:
        try:
            known = self.Vaults.model_validate_json(
                (obsidian_home() / "obsidian.json").read_bytes()
            )
        except (OSError, ValidationError):
            return []
        vaults = sorted(known.vaults.values(), key=lambda v: (not v.open, v.path))
        return [
            Choice(label=Path(v.path).name, locator=v.path, open=v.open) for v in vaults
        ]


class Role(Enum):
    OWNER = "owner"
    ASSISTANT = "assistant"
    OTHER = "other"


class Turn(BaseModel):
    role: Role = Field(
        default=Role.OTHER,
        validation_alias=AliasChoices("sender", AliasPath("author", "role")),
    )
    text: str = Field(
        default="", validation_alias=AliasChoices("text", AliasPath("content", "parts"))
    )
    at: str | float | None = Field(
        default=None, validation_alias=AliasChoices("created_at", "create_time")
    )

    @field_validator("role", mode="before")
    @classmethod
    def parse_role(cls, value: object) -> Role:
        if value in ("human", "user"):
            return Role.OWNER
        return Role.ASSISTANT if value == "assistant" else Role.OTHER

    @field_validator("text", mode="before")
    @classmethod
    def parse_text(cls, value: object) -> str:
        if isinstance(value, list):
            return "\n".join(part for part in value if isinstance(part, str)).strip()
        return value.strip() if isinstance(value, str) else ""


class Node(BaseModel):
    parent: str | None = None
    message: Turn | None = None


class Conversation(BaseModel):
    id: str = Field(default="", validation_alias=AliasChoices("uuid", "id"))
    title: str = Field(default="", validation_alias=AliasChoices("title", "name"))
    at: str | float | None = Field(
        default=None, validation_alias=AliasChoices("create_time", "created_at")
    )
    mapping: dict[str, Node] | None = None
    current_node: str | None = None
    chat_messages: list[Turn] = Field(default_factory=list)

    def turns(self) -> list[Turn]:
        if self.mapping is None:
            return self.chat_messages
        # Only the selected branch was read; regenerated siblings are excluded.
        turns: list[Turn] = []
        visited: set[str] = set()
        node = self.current_node
        while node in self.mapping and node not in visited:
            visited.add(node)
            current = self.mapping[node]
            if (
                current.message
                and current.message.role is not Role.OTHER
                and current.message.text
            ):
                turns.append(current.message)
            node = current.parent
        return list(reversed(turns))

    def item(self, locator: str, index: int, sentence: int) -> Item:
        turns = self.turns()
        blocks: list[str] = []
        for position, turn in enumerate(turns):
            if turn.role is not Role.OWNER or len(turn.text) < sentence:
                continue
            blocks.append(turn.text)
            answer = turns[position + 1] if position + 1 < len(turns) else None
            if answer and answer.role is Role.ASSISTANT:
                blocks.append(f"Reply: {answer.text[:600]}")
        spoken = next((turn.text for turn in turns if turn.role is Role.OWNER), "")
        when = next((turn.at for turn in turns if turn.at), self.at)
        try:
            dated = (
                datetime.fromtimestamp(when, timezone.utc).date().isoformat()
                if isinstance(when, (int, float))
                else date.fromisoformat(when[:10]).isoformat()
                if when
                else None
            )
        except (ValueError, OSError, OverflowError):
            dated = None
        return Item(
            self.title.strip() or spoken.split("\n")[0][:60],
            "\n\n".join(blocks),
            f"{locator}#{self.id or index}",
            dated,
        )


class ExportReader(Reader):
    kind = "export"
    refresh = False
    products = {"chatgpt": "ChatGPT", "claude": "Claude"}
    # One product's exports only, when an app rather than a file was connected.
    product: ClassVar[str] = ""

    @classmethod
    def locate(cls, locator: str) -> tuple[str, str]:
        # Which product it came from is only known once read, so no label yet.
        path = Path(locator).expanduser().resolve()
        return str(path), ""

    @cached_property
    def conversations(self) -> list[Conversation] | None:
        path = Path(self.source.locator)
        try:
            if zipfile.is_zipfile(path):
                with zipfile.ZipFile(path) as archive:
                    name = next(
                        (
                            name
                            for name in archive.namelist()
                            if Path(name).name == "conversations.json"
                        ),
                        "",
                    )
                    with archive.open(name) as member:
                        loaded = json.load(member)
            else:
                loaded = json.loads(path.read_bytes())
            if not isinstance(loaded, list):
                return None
            return [
                Conversation.model_validate(entry)
                for entry in loaded
                if isinstance(entry, dict)
            ]
        except (OSError, ValueError, KeyError, zipfile.BadZipFile):
            return None

    @cached_property
    def provider(self) -> str | None:
        if not self.conversations:
            return None
        return "chatgpt" if self.conversations[0].mapping is not None else "claude"

    def probe(self) -> State:
        self.label = self.products.get(self.provider or "", "Export")
        if self.conversations is None:
            return State.UNREACHABLE
        if self.product and self.provider and self.provider != self.product:
            raise SourceError(
                f"this is a {self.label} export, not {self.products[self.product]}"
            )
        return State.CONNECTED if self.conversations else State.NOTHING_FOUND

    def name(self) -> str:
        # A newer download of the same history is the same source, whatever it
        # was saved as, so the name is the product rather than the file.
        if self.source.connector:
            return f"{self.source.connector}-export"
        return f"{self.kind}-{self.provider or 'empty'}"

    def items(self) -> Iterator[Item]:
        for index, conversation in enumerate(self.conversations or []):
            item = conversation.item(self.source.locator, index, self.sentence)
            yield replace(item, key=conversation.id or None)


class ChatGPTExport(ExportReader):
    product = "chatgpt"


class ClaudeExport(ExportReader):
    product = "claude"


class ChatGPT(Connector):
    id = "chatgpt"
    name = "ChatGPT"
    what = "Your conversations, from an export file"
    unit = "export"
    item = "conversation"
    reader = ChatGPTExport


class Claude(Connector):
    id = "claude"
    name = "Claude"
    what = "Your conversations, from an export file"
    unit = "export"
    item = "conversation"
    reader = ClaudeExport


class FeedPost(BaseModel):
    """The text, URL, and date shared by JSON Feed and Mastodon posts."""

    id: str = ""
    title: str = ""
    html: str = Field(
        default="", validation_alias=AliasChoices("content_html", "content")
    )
    text: str = Field(default="", validation_alias="content_text")
    url: str = Field(default="", validation_alias=AliasChoices("url", "uri"))
    at: str = Field(
        default="", validation_alias=AliasChoices("date_published", "created_at")
    )
    reblog: dict[str, object] | None = None
    in_reply_to_id: str | None = None


class JsonFeed(BaseModel):
    title: str = ""
    items: list[FeedPost]


class BlueskyPost(BaseModel):
    uri: str = Field(validation_alias=AliasPath("post", "uri"))
    text: str = Field(default="", validation_alias=AliasPath("post", "record", "text"))
    at: str = Field(
        default="", validation_alias=AliasPath("post", "record", "createdAt")
    )
    handle: str = Field(
        default="", validation_alias=AliasPath("post", "author", "handle")
    )
    author: str = Field(
        default="", validation_alias=AliasPath("post", "author", "displayName")
    )
    reply: dict[str, object] | None = Field(
        default=None, validation_alias=AliasPath("post", "record", "reply")
    )
    reason: dict[str, object] | None = None


class BlueskyPage(BaseModel):
    feed: list[BlueskyPost]
    cursor: str | None = None


class MastodonAccount(BaseModel):
    id: str
    display_name: str = ""


class FeedReader(Reader):
    kind = "feed"
    agent = f"Lore/{__version__} (+https://yourlore.dev)"
    timeout = 20
    # A feed is a recent window, not an archive: five pages of Bluesky or
    # Mastodon is the whole of what this importer promises.
    pages = 5
    limit = 40
    guesses = ("/feed", "/rss/", "/atom.xml", "/feed.json")
    # What a paid post arrives as: the free opening, then the prompt Substack
    # cuts it off with. A fully paid post is under the sentence floor anyway.
    paywall = re.compile(
        r"\nread more$"
        r"|this (?:post|episode) is for (?:paid|pledging|founding)"
        r"|subscribe to (?:read|listen|watch|keep reading)"
        r"|paid subscribers only",
        re.IGNORECASE,
    )

    def __init__(self, source: Source) -> None:
        super().__init__(source)
        self.reached = False

    @classmethod
    def locate(cls, locator: str) -> tuple[str, str]:
        handle = cls._handle(locator)
        if handle:
            return f"@{handle}", f"@{handle}"
        typed = locator.strip()
        url = typed if "://" in typed else f"https://{typed}"
        return url, urlsplit(url).netloc

    @cached_property
    def posts(self) -> list[Item]:
        # One read, however many fetches resolving it took: `probe` and `items`
        # are two questions about the same answer.
        try:
            found = self._read()
        except (OSError, ValueError, ParseError, LookupError, TypeError):
            return []
        self.reached = True
        return found

    def probe(self) -> State:
        if self.posts:
            return State.CONNECTED
        return State.NOTHING_FOUND if self.reached else State.UNREACHABLE

    def items(self) -> Iterator[Item]:
        for post in self.posts:
            yield post

    def fetch(self, url: str) -> bytes:
        request = urllib.request.Request(url, headers={"User-Agent": self.agent})
        with urllib.request.urlopen(request, timeout=self.timeout) as response:
            return bytes(response.read())

    @classmethod
    def _handle(cls, locator: str) -> str:
        typed = locator.strip()
        name = typed.lstrip("@")
        if "://" in typed or "/" in name:
            return ""
        return name if typed.startswith("@") or name.endswith(".bsky.social") else ""

    def _read(self) -> list[Item]:
        handle = self._handle(self.source.locator)
        if "@" in handle:
            return self._mastodon(handle)
        if handle:
            return self._bluesky(handle)
        return self._site(self.source.locator)

    def _site(self, url: str) -> list[Item]:
        body = self.fetch(url)
        posts = self._feed(body)
        if posts is not None:
            return posts
        for candidate in [
            urljoin(url, link)
            for link in _Html(body.decode("utf-8", "replace")).links
            if link
        ] + [urljoin(url, guess) for guess in self.guesses]:
            try:
                posts = self._feed(self.fetch(candidate))
            except OSError:
                continue
            if posts is not None:
                return posts
        raise OSError(f"no feed at {url}")

    def _feed(self, body: bytes) -> list[Item] | None:
        try:
            root = fromstring(body)
        except ParseError:
            return self._json_feed(body)
        if root.tag.rpartition("}")[2] not in ("rss", "feed"):
            return None
        channel = next((e for e in root if e.tag.rpartition("}")[2] == "channel"), root)
        self.label = _field(channel, "title") or self.label
        return [
            self._item(e, index)
            for index, e in enumerate(channel)
            if e.tag.rpartition("}")[2] in ("item", "entry")
        ]

    def _json_feed(self, body: bytes) -> list[Item] | None:
        try:
            payload = JsonFeed.model_validate_json(body)
        except ValueError:
            return None
        self.label = payload.title or self.label
        return [
            self._post(
                post.title,
                _Html(post.html).text() or post.text,
                post.url or post.id,
                post.at,
            )
            for post in payload.items
        ]

    def _item(self, entry: Element, index: int) -> Item:
        # `content:encoded` is the whole post where a feed carries both.
        body = next(
            (
                value
                for field in ("encoded", "content", "description", "summary")
                if (value := _field(entry, field))
            ),
            "",
        )
        link = _field(entry, "link")
        identity = link or _field(entry, "id", "guid") or f"entry-{index}"
        post = self._post(
            _field(entry, "title"),
            _Html(body).text(),
            link or f"{self.source.locator}#{identity}",
            _field(entry, "pubDate", "published", "updated", "date"),
        )
        # ponytail: anonymous entries use their position; prefer a publisher ID
        # if one appears, since reordering those entries changes their keys.
        return replace(post, key=identity)

    def _bluesky(self, handle: str) -> list[Item]:
        url = (
            "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed"
            f"?actor={quote(handle)}&filter=posts_no_replies&limit={self.limit}"
        )
        posts: list[Item] = []
        cursor = ""
        for _ in range(self.pages):
            page = BlueskyPage.model_validate_json(self.fetch(url + cursor))
            for post in page.feed:
                if not post.reason and post.author:
                    self.label = post.author
                posts.append(
                    self._post(
                        "",
                        post.text,
                        f"https://bsky.app/profile/{post.handle or handle}/post/{post.uri.rsplit('/', 1)[-1]}",
                        post.at,
                        drop=bool(post.reason or post.reply),
                    )
                )
            if not page.cursor:
                break
            cursor = f"&cursor={quote(page.cursor)}"
        return posts

    def _mastodon(self, address: str) -> list[Item]:
        user, _, instance = address.partition("@")
        account = MastodonAccount.model_validate_json(
            self.fetch(f"https://{instance}/api/v1/accounts/lookup?acct={quote(user)}")
        )
        self.label = account.display_name or self.label
        url = (
            f"https://{instance}/api/v1/accounts/{account.id}/statuses"
            f"?exclude_replies=true&exclude_reblogs=true&limit={self.limit}"
        )
        posts: list[Item] = []
        page = url
        for _ in range(self.pages):
            statuses = TypeAdapter(list[FeedPost]).validate_json(self.fetch(page))
            for post in statuses:
                posts.append(
                    self._post(
                        "",
                        _Html(post.html).text(),
                        post.url or post.id,
                        post.at,
                        drop=bool(post.reblog or post.in_reply_to_id),
                    )
                )
            if len(statuses) < self.limit:
                break
            page = f"{url}&max_id={quote(statuses[-1].id)}"
        return posts

    def _post(
        self, title: str, text: str, link: str, when: str, drop: bool = False
    ) -> Item:
        headline = text.strip().split("\n", 1)[0]
        if len(headline) > 80:
            headline = headline[:79].rstrip() + "…"
        return Item(
            title or headline,
            text,
            link,
            _date(when),
            excluded=drop or bool(self.paywall.search(text)),
            key=link,
        )


class Substack(Connector):
    id = "substack"
    name = "Substack"
    what = "Your published posts"
    unit = "newsletter"
    item = "post"
    reader = FeedReader
    placeholder = "https://you.substack.com"


class _Html(HTMLParser):
    # The two things a feed importer wants out of HTML: a post's text with its
    # paragraphs intact, and the feeds a site page advertises.
    blocks = {
        "p",
        "div",
        "li",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "blockquote",
        "pre",
        "tr",
    }
    feeds = {"application/rss+xml", "application/atom+xml", "application/feed+json"}
    silent = ("script", "style")

    def __init__(self, markup: str) -> None:
        super().__init__()
        self.parts: list[str] = []
        self.links: list[str] = []
        self.quiet = 0
        self.feed(markup)
        self.close()

    def text(self) -> str:
        joined = re.sub(r"[^\S\n]+", " ", "".join(self.parts))
        return re.sub(r"\n{3,}", "\n\n", re.sub(r" ?\n ?", "\n", joined)).strip()

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key: value or "" for key, value in attrs}
        if (
            tag == "link"
            and "alternate" in values.get("rel", "").split()
            and values.get("type") in self.feeds
        ):
            self.links.append(values.get("href", ""))
        elif tag in self.silent:
            self.quiet += 1
        elif tag == "br":
            self.parts.append("\n")
        elif tag in self.blocks:
            self.parts.append("\n\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.silent:
            self.quiet = max(self.quiet - 1, 0)
        elif tag in self.blocks:
            self.parts.append("\n\n")

    def handle_data(self, data: str) -> None:
        if not self.quiet:
            self.parts.append(data)


class LastRead(BaseModel):
    at: str
    state: State


class Registry:
    """Source configuration and imports, sharing one store and one read snapshot."""

    source_records = TypeAdapter(list[Source])
    read_records = TypeAdapter(dict[str, LastRead])

    def __init__(self, store: Store) -> None:
        self.store = store
        try:
            self.owned = self.source_records.validate_python(
                store.setting("owner_sources", [])
            )
            self.reads = self.read_records.validate_python(
                store.setting("source_reads", {})
            )
        except ValidationError as error:
            raise SourceError(f"invalid saved sources: {error}") from None
        configured = store.setting("sources", [])
        self.enabled = set(configured) if isinstance(configured, list) else set()
        self.sources = available_sources() + self.owned

    def entries(self) -> list[dict[str, object]]:
        counts = self.store.source_counts()
        entries: list[dict[str, object]] = []
        for source in self.sources:
            if source.origin == "automation":
                continue
            enabled = source.owned or source.name in self.enabled
            last = self.reads.get(source.name)
            state = (
                (last.state if last else source.reader().probe())
                if enabled
                else State.OFF
            )
            entries.append(
                {
                    "name": source.name,
                    "label": source.label,
                    "kind": source.kind,
                    "locator": source.locator,
                    "owned": source.owned,
                    "connector": source.connector,
                    "refresh": source.reader().refresh,
                    "enabled": enabled,
                    "imported": counts.get(source.name, 0),
                    "state": state.value,
                    "last_read_at": last.at if last else None,
                }
            )
        return entries

    def add(
        self,
        locator: str,
        label: str | None = None,
        since: str | None = None,
        kind: str = "folder",
        connector: str | None = None,
        *,
        replacing: str | None = None,
    ) -> dict[str, object]:
        """Read a new source, and only then retire the one it replaces."""
        source = Source.owner(locator, label, since, kind, connector)
        reader = source.reader()
        if reader.probe() is State.UNREACHABLE:
            raise SourceError(f"can't reach {locator}")
        source = replace(source, name=reader.name(), label=source.label or reader.label)
        current = next((r for r in self.owned if r.name == source.name), None)
        if current is not None and current.locator == source.locator:
            return next(e for e in self.entries() if e["name"] == source.name)
        if replacing is not None and replacing != source.name:
            old = next((r for r in self.owned if r.name == replacing), None)
            if old is None or old.connector != source.connector:
                raise SourceError(
                    f"{replacing} is not a {connector or kind} to replace"
                )
            self.remove(replacing, delete=False)
        self.owned = [r for r in self.owned if r.name != source.name] + [source]
        self.sources = [r for r in self.sources if r.name != source.name] + [source]
        self.store.set_setting(
            "owner_sources", self.source_records.dump_python(self.owned, mode="json")
        )
        self._import(source, reader)
        self._save_reads()
        return next(entry for entry in self.entries() if entry["name"] == source.name)

    def connect(
        self, app: str, locator: str, *, replacing: str | None = None
    ) -> dict[str, object]:
        connector = Connector.named(app)
        return self.add(
            locator, kind=connector.reader.kind, connector=app, replacing=replacing
        )

    def read(self, names: list[str] | None = None) -> list[dict[str, object]]:
        known = {s.name: s for s in self.sources if s.origin != "automation"}
        if names:
            unknown = set(names) - known.keys()
            if unknown:
                raise SourceError(f"unknown source: {sorted(unknown)[0]}")
            chosen = names
        else:
            chosen = [
                s.name for s in known.values() if s.owned or s.name in self.enabled
            ]
        report = self.scan(set(chosen))
        return [
            {
                "name": name,
                **{key: value for key, value in report[name].items() if key != "found"},
                "state": self.reads[name].state.value,
            }
            for name in chosen
        ]

    def remove(self, name: str, *, delete: bool) -> dict[str, object]:
        if name in {source.name for source in available_sources()}:
            raise SourceError(f"{name} is built in and cannot be removed")
        remaining = [source for source in self.owned if source.name != name]
        if len(remaining) == len(self.owned):
            raise SourceError(f"unknown source: {name}")
        self.owned = remaining
        self.sources = [source for source in self.sources if source.name != name]
        self.reads.pop(name, None)
        self.store.set_setting(
            "owner_sources", self.source_records.dump_python(self.owned, mode="json")
        )
        self._save_reads()
        memories = (
            self.store.delete_source_memories(name)
            if delete
            else {"kept": self.store.source_counts().get(name, 0)}
        )
        return {"name": name, "removed": True, "memories": memories}

    def scan(self, names: set[str] | None = None) -> dict[str, dict[str, int]]:
        """Import changed items privately, preserving stable keys and review status."""
        report = {
            source.name: self._import(source, source.reader())
            for source in self.sources
            if names is None or source.name in names
        }
        self._save_reads()
        return report

    def _import(self, source: Source, reader: Reader) -> dict[str, int]:
        stats = {"found": 0, "added": 0, "updated": 0, "unchanged": 0, "errors": 0}
        state = reader.probe()
        for item in reader.items():
            stats["found"] += 1
            if not reader.keeps(item):
                continue
            path = Path(item.source_path)
            result = self.store.put(
                source=source.name,
                origin=source.origin,
                source_path=item.source_path,
                source_key=f"{source.name}:{item.key or path.resolve()}",
                fingerprint=hashlib.sha256(item.content.encode()).hexdigest(),
                title=item.title,
                content=item.content,
                project=_project(source, path),
            )
            stats[result] += 1
        stats["found"] += reader.errors
        stats["errors"] = reader.errors
        self.reads[source.name] = LastRead(
            at=datetime.now(timezone.utc).isoformat(), state=reader.failure or state
        )
        return stats

    def _save_reads(self) -> None:
        self.store.set_setting(
            "source_reads", self.read_records.dump_python(self.reads, mode="json")
        )


def available_sources() -> list[Source]:
    """Return native and synthesized memory sources for the current user."""
    return [
        Source("codex", "Codex", str(codex_home() / "memories"), "MEMORY.md"),
        Source(
            "claude", "Claude Code", str(claude_home() / "projects"), "*/memory/*.md"
        ),
        Source(
            "automation", "Synthesis", str(home() / "memories"), origin="automation"
        ),
    ]


def preview(locator: str, kind: str = "folder") -> dict[str, object]:
    """Report what a source would import, writing nothing."""
    reader = Source.owner(locator, kind=kind).reader()
    state = reader.probe()
    kept: list[Item] = []
    skipped = 0
    for item in reader.items():
        if reader.keeps(item):
            kept.append(item)
        else:
            skipped += 1
    dates = sorted(item.dated for item in kept if item.dated)
    return {
        "label": reader.label,
        "count": len(kept),
        "from": dates[0] if dates else None,
        "to": dates[-1] if dates else None,
        "skipped": skipped,
        "state": (reader.failure or state).value,
    }


def _day(value: str | None) -> str | None:
    if value is None:
        return None
    try:
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise SourceError(f"not a date: {value}") from None


def _title(path: Path, content: str) -> str:
    match = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    return (
        match.group(1).strip()
        if match
        else path.stem.replace("_", " ").replace("-", " ").title()
    )


def _project(source: Source, path: Path) -> str:
    if source.name == "claude":
        return path.parents[1].name
    if source.name == "codex":
        relative = path.relative_to(Path(source.locator))
        return relative.parts[0] if len(relative.parts) > 1 else ""
    return "personal"


def _field(element: Element, *names: str) -> str:
    for child in element:
        if child.tag.rpartition("}")[2] in names:
            value = "".join(child.itertext()).strip() or child.get("href", "").strip()
            if value:
                return value
    return ""


def _date(value: str) -> str | None:
    iso = re.match(r"\s*(\d{4}-\d{2}-\d{2})", value)
    if iso:
        return iso.group(1)
    try:
        return parsedate_to_datetime(value).date().isoformat()
    except (TypeError, ValueError):
        return None
