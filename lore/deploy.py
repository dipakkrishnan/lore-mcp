"""Deploy the owner's Lore node to their own Cloudflare account.

The Worker source ships inside this package (`lore/node`), so deployment never
needs the git repository: `lore node deploy` materializes the source to
`~/.lore/node`, then drives npm and wrangler there. The Worker version always
matches the installed CLI version — the property that matters once `lore push`
and the Worker share a D1 schema (MON-003).
"""

from __future__ import annotations

import fcntl
import hashlib
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager
from fnmatch import fnmatch
from importlib import resources
from pathlib import Path
from typing import Iterator, Literal

from pydantic import BaseModel, TypeAdapter

from . import blueprint, usage
from .cloudflare import Account, Cloudflare, CloudflareError, subdomain_name
from .paths import home, store_folder
from .store import JobKind, Store
from .ui import muted, success, warn

# What must never reach ~/.lore/node from a dev checkout. The wheel itself
# ships only the files pyproject.toml's package-data names, so that list is
# the single manifest of what deploys.
EXCLUDED = ("node_modules", ".wrangler", ".buyer.env", ".dev.vars", "*.log")
WRANGLER = "node_modules/.bin/wrangler"
# Written only once an install has finished.
INSTALLED = ".installed"
# Where the store pays out, written only by a deploy that set it.
PAYOUT = "payout.json"
# Which store this Lore last put online from this Mac, written by every deploy that went out.
DEPLOYED = "deployed.json"
DATABASE_ID = "[0-9a-f-]{36}"
WALLET = re.compile(r"0x[0-9a-fA-F]{40}")
D1_NAME = "lore-publications"
D1_PLACEHOLDER = "REPLACE_WITH_YOUR_D1_ID"
VERIFY_EMAIL = (
    "Cloudflare needs you to verify your email first. Check your inbox for their "
    "email, click the link, then tap Set it up again."
)
NOT_SIGNED_IN = "not signed in to Cloudflare; sign in first, then rerun"
MANY_ACCOUNTS = (
    "Your Cloudflare sign-in has more than one account. Choose the one your store "
    "goes on (`lore node accounts`), then set it up again."
)
NO_SUBDOMAIN = (
    "Your Cloudflare account needs a web address before your store can go online, "
    "and Lore couldn't make one. Open {link}, pick a name, then tap Set it up again."
)
TIMED_OUT = (
    "Cloudflare took too long to answer, so your store didn't go online. Check "
    "your connection, then try again."
)
NOT_ANSWERING = (
    "Your store went up but isn't answering yet. Give it a few minutes, then open "
    "it again."
)
# The one account the owner chose when their sign-in has several (XC-087).
ACCOUNT_SETTING = "cloudflare_account"
ACCOUNT_ID = re.compile(r"[0-9a-f]{32}")
# A brand-new workers.dev address takes a few minutes to answer: ask every 10s for 3 minutes.
FRESH_PROBES = 18
# The store log keeps about the last 64 KB of failures.
LOG_KEEP = 64_000
NEEDS_NODE = "deploying needs Node.js; install it from nodejs.org and rerun"
# Generous enough for a cold `npm install` plus a `wrangler deploy` on a slow
# connection, but bounded: nothing in this chain may block a caller (the
# desktop agent's turn, a terminal session) indefinitely (MON-023).
SUBPROCESS_TIMEOUT_S = 300
PRICE_DECLARATION = "export const PRICE_USD = 0.01;"
# `*`, not a column list: a node deployed before `refund_owed` existed still
# reads, and the field defaults to nothing owed.
SALES_QUERY = "SELECT * FROM sales ORDER BY sold_at DESC, id DESC"
# A free first copy (MON-040): a $0 ledger row, never earnings and never owed back.
FREE_NETWORK = "free"


class Sale(BaseModel):
    """One settled paid call, as the node's ledger records it."""

    kind: Literal["publication", "answer"]
    item_id: str
    title: str
    price_usd: float
    network: str
    payer: str
    tx: str
    sold_at: str
    # A paid answer that ended refused or failed: the owner refunds the payer.
    refund_owed: bool = False


SALES = TypeAdapter(list[Sale])
# The Worker creates the table on the first view; creating it here too means
# a store nobody has visited yet reads as no views, not an error.
VIEWS_QUERY = (
    "CREATE TABLE IF NOT EXISTS page_views "
    "(item_id TEXT PRIMARY KEY, views INTEGER NOT NULL); "
    "SELECT item_id, views FROM page_views"
)


class PageViews(BaseModel):
    """How often one piece's page was opened; the node keeps nothing else."""

    item_id: str
    views: int


VIEWS = TypeAdapter(list[PageViews])
# Plain words for the two chains the Worker accepts as LORE_NETWORK.
NETWORKS = {"real": "eip155:8453", "test": "eip155:84532"}
# The owner's own Coinbase facilitator credentials, optional: without them real
# money settles through a keyless facilitator. Nothing else is vaulted here.
SECRETS = ("CDP_API_KEY_ID", "CDP_API_KEY_SECRET")
# The smallest price the six-decimal formatter can render without collapsing
# to zero; `lore price` rounds to six decimals, so this matches its floor.
MINIMUM_PRICE = 1e-6
# The owner's choice to sell (XC-069), in three states, none of them guessed:
# - true: written only after a full deploy's push succeeded;
# - false: written only by a deploy that created a brand-new D1 database in
#   that run, before its push (and kept until a full deploy opens the store);
# - unset: every store from before XC-069, which behaves exactly as it did:
#   its push carries the pieces and no `selling` key, so its node sells.
SELLING_SETTING = "node_selling"


class StoreFailed(OSError):
    """Why the store didn't go online (XC-085): one plain line for the owner, a
    reason from usage.STORE_FAILURES for the usage event, and everything the
    tools said for the store log."""

    # The words each cause is known by, in what wrangler and Lore print.
    KNOWN = (
        (
            "email_unverified",
            re.compile(
                r"verify your account's email|email_verification_required|"
                r"verify your email|\b10034\b",
                re.IGNORECASE,
            ),
        ),
        ("no_subdomain", re.compile(r"register a workers\.dev subdomain")),
        ("many_accounts", re.compile(r"More than one account available")),
        ("exists_elsewhere", re.compile(r"already exists on this Cloudflare account")),
        ("not_signed_in", re.compile(r"not signed in to Cloudflare|Not logged in")),
        ("no_payout", re.compile(r"your store has no way to be paid")),
        ("timeout", re.compile(r"timed out after \d+s")),
        ("not_answering", re.compile(r"did not answer discover")),
    )

    def __init__(self, reason: str, said: str, detail: str = "") -> None:
        super().__init__(said)
        self.reason = reason
        self.detail = detail or said

    @classmethod
    def of(cls, error: BaseException, output: str = "") -> StoreFailed:
        """The failure `error` is, told by its words and the tools' full output."""
        if isinstance(error, StoreFailed):
            return error
        text = str(error)
        detail = f"{text}\n{output}".strip()
        for reason, words in cls.KNOWN:
            if words.search(detail):
                return cls(reason, cls._said(reason, text, detail), detail)
        return cls("other", _one_line(text), detail)

    @staticmethod
    def _said(reason: str, text: str, detail: str) -> str:
        if reason == "email_unverified":
            return VERIFY_EMAIL
        if reason == "many_accounts":
            return MANY_ACCOUNTS
        if reason == "no_subdomain":
            link = re.search(r"https://dash\.cloudflare\.com/\S+", detail)
            return NO_SUBDOMAIN.format(
                link=link.group(0) if link else "dash.cloudflare.com"
            )
        if reason == "not_signed_in":
            return NOT_SIGNED_IN
        if reason == "timeout":
            return TIMED_OUT
        if reason == "not_answering":
            return NOT_ANSWERING
        # A store elsewhere and a missing payout are already said in full.
        return text

    def log(self) -> Path:
        """Keep everything the tools said, where the owner can send it with feedback."""
        return _store_log(f"{self.reason}: {self.detail}")


def _one_line(text: str) -> str:
    """A tool's failure on one line: what Lore was doing, and the last thing it said."""
    head, _, rest = text.partition("\n")
    last = next(
        (line.strip() for line in reversed(rest.splitlines()) if line.strip()), ""
    )
    head = head.strip().rstrip(":")
    return (f"{head}: {last}" if last else head)[:400]


def store_log() -> Path:
    return home() / "logs" / "store.log"


def _store_log(entry: str) -> Path:
    path = store_log()
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    try:
        kept = path.read_text(encoding="utf-8")[-LOG_KEEP:]
    except OSError:
        kept = ""
    _replace(path, f"{kept}{stamp} {entry}\n")
    return path


def choice(store: Store) -> bool | None:
    """The owner's choice to sell: true, false, or unset (a store from before XC-069)."""
    chosen = store.setting(SELLING_SETTING, None)
    return chosen if isinstance(chosen, bool) else None


def selling(store: Store) -> bool:
    """Whether the store is online and open for sale, not only for agents: an
    address, and no explicit no."""
    return bool(store.setting("node_url", None)) and choice(store) is not False


def takes_cards() -> bool:
    """Whether the owner takes card payments (XC-039), which is enough for the
    store to sell with no payout address."""
    with Store() as store:
        return bool(store.setting("stripe_account", ""))


def _refuse_dev_source_drift(packaged: Path) -> None:
    """Stop an installed CLI from ignoring edits in the current checkout."""
    for root in (Path.cwd(), *Path.cwd().parents):
        checkout = root / "lore/node"
        project = root / "pyproject.toml"
        if not checkout.is_dir() or not project.is_file():
            continue
        if 'name = "lore-mcp"' not in project.read_text():
            continue
        if packaged.resolve() == checkout.resolve():
            return
        if any(
            not (other := checkout / source.relative_to(packaged)).is_file()
            or source.read_bytes() != other.read_bytes()
            for source in packaged.rglob("*")
            if source.is_file()
        ):
            raise OSError(
                "installed Lore CLI differs from this checkout; deploy stopped "
                f"before using stale code. From {root}, run "
                "`uv tool install --force --reinstall .`, then rerun `lore node deploy`."
            )
        return


def _database_id(config: Path, shape: str = r"[^\"]+") -> str | None:
    """The D1 database a store's config points at, if it names one."""
    if not config.is_file():
        return None
    match = re.search(rf'"database_id":\s*"({shape})"', config.read_text())
    return match.group(1) if match and match.group(1) != D1_PLACEHOLDER else None


def _moved_id() -> str | None:
    """The database of a store set up inside Lore's home, before the store moved
    out of it. Only an id carries over from there, and only one shaped like one."""
    return _database_id(home() / "node" / "wrangler.jsonc", DATABASE_ID)


def _kept_id(config: Path) -> str | None:
    """The database a rebuilt store keeps: its own real id, else the one from
    before the store moved, else whatever the owner pasted."""
    own = _database_id(config)
    if own and re.fullmatch(DATABASE_ID, own):
        return own
    return _moved_id() or own


def _pinned(config: str, account: object) -> str:
    """The store's config on the account the owner chose, so every later wrangler
    command (a push, a sales read) goes there without asking; or on none."""
    config = re.sub(r'\n\s*"account_id": "[^"]*",', "", config)
    if not isinstance(account, str) or not ACCOUNT_ID.fullmatch(account):
        return config
    return config.replace(
        '"name": "lore",', f'"name": "lore",\n  "account_id": "{account}",', 1
    )


def _replace(path: Path, text: str) -> None:
    """Write a file whole or not at all."""
    partial = path.with_name(f".{path.name}.partial")
    partial.write_text(text)
    os.replace(partial, path)


@contextmanager
def store_lock() -> Iterator[None]:
    """One process at a time builds or installs the store: the app's sales and
    inbox checks run on their own and may both find it unfinished."""
    folder = store_folder()
    folder.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(folder.with_name(f"{folder.name}.lock"), "a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _build(folder: Path, database_id: str | None, price_usd: float | None) -> None:
    """Lay the packaged Worker source into `folder` with its price, if any, and database."""
    with resources.as_file(resources.files("lore") / "node") as source_dir:
        _refuse_dev_source_drift(source_dir)
        shutil.copytree(
            source_dir,
            folder,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns(*EXCLUDED, "wrangler.jsonc"),
        )
        config = (source_dir / "wrangler.jsonc").read_text()
    price_file = folder / "src/price.ts"
    source = price_file.read_text()
    if PRICE_DECLARATION not in source:
        raise OSError(f"could not configure the node price in {price_file}")
    if price_usd is not None:
        price = f"{price_usd:.6f}".rstrip("0").rstrip(".")
        price_file.write_text(
            source.replace(PRICE_DECLARATION, f"export const PRICE_USD = {price};")
        )
    if database_id:
        config = config.replace(D1_PLACEHOLDER, database_id)
    with Store() as store:
        account = store.setting(ACCOUNT_SETTING, None)
    _replace(folder / "wrangler.jsonc", _pinned(config, account))
    # Owner-only, like the rest of ~/.lore — after copytree, which copystats
    # the package directory's world-readable mode onto the target.
    folder.chmod(0o700)


def materialize(price_usd: float | None) -> Path:
    """Copy the packaged Worker source to the store folder, never touching secrets.

    Re-running overwrites the source files (that is the upgrade path); files
    the owner created (`.buyer.env`, `.dev.vars`) stay untouched. With no
    price the shipped one stays: a store with nothing for sale charges nothing.
    A store set up inside Lore's home is rebuilt here, carrying over only its database id.
    A first build is made beside the folder and moved in whole, and the config
    is only ever written with its id in it, so an interrupted run leaves
    nothing half-made behind.
    """
    target = store_folder()
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    # The owner pastes their D1 database_id into wrangler.jsonc after
    # `wrangler d1 create`; an upgrade must not reset it to the placeholder.
    existing_id = _kept_id(target / "wrangler.jsonc")
    if target.is_dir():
        _build(target, existing_id, price_usd)
        return target
    building = Path(tempfile.mkdtemp(prefix=f".{target.name}-", dir=target.parent))
    try:
        _build(building, existing_id, price_usd)
        os.replace(building, target)
    except BaseException:
        shutil.rmtree(building, ignore_errors=True)
        raise
    return target


def shipped_store() -> str:
    """A digest of the store this Lore ships: every packaged file a deploy lays
    down, by path and content. Two Lore releases that ship the same store agree."""
    digest = hashlib.sha256()
    with resources.as_file(resources.files("lore") / "node") as source_dir:
        for root, dirs, files in os.walk(source_dir):
            dirs[:] = sorted(d for d in dirs if not _excluded(d))
            for name in sorted(files):
                if _excluded(name):
                    continue
                path = Path(root, name)
                digest.update(path.relative_to(source_dir).as_posix().encode())
                digest.update(b"\0" + path.read_bytes() + b"\0")
    return digest.hexdigest()


def _excluded(name: str) -> bool:
    return any(fnmatch(name, pattern) for pattern in EXCLUDED)


def _record_store(target: Path) -> None:
    """Keep which store went online, beside its payout record: the app offers an
    update once this Lore ships a newer one."""
    _replace(target / DEPLOYED, json.dumps({"store": shipped_store()}))


def store_state(node_url: object) -> Literal["current", "outdated", "unknown"]:
    """Whether the store online is the one this Lore ships (APP-231). Only a store
    this Mac put online can be behind: one with no record here is unknown, never
    outdated, so the app never offers to update a store another Mac set up. A
    store put online from this Mac before the record was kept has its payout
    record instead, which only a deploy from here writes."""
    if not node_url:
        return "unknown"
    target = store_folder()
    try:
        kept = json.loads((target / DEPLOYED).read_text()).get("store")
    except (OSError, ValueError, AttributeError):
        kept = None
    if not isinstance(kept, str):
        return "outdated" if (target / PAYOUT).is_file() else "unknown"
    return "current" if kept == shipped_store() else "outdated"


def installed(target: Path) -> bool:
    """Whether the store's packages finished installing, not just started."""
    return (target / INSTALLED).is_file() and (target / WRANGLER).exists()


def _packages(target: Path) -> str:
    """Which packages the store asks for, as its manifest and lockfile say."""
    digest = hashlib.sha256()
    for name in ("package.json", "package-lock.json"):
        path = target / name
        digest.update(path.read_bytes() if path.is_file() else b"")
    return digest.hexdigest()


def current(target: Path) -> bool:
    """Whether the packages installed are the ones the store asks for now, so a
    second try after a failure doesn't install them all again (XC-087)."""
    return installed(target) and (target / INSTALLED).read_text() == _packages(target)


def _recorded(target: Path) -> dict[str, object]:
    try:
        kept = json.loads((target / PAYOUT).read_text())
    except (OSError, ValueError):
        return {}
    return kept if isinstance(kept, dict) else {}


def _recorded_address(target: Path) -> str | None:
    """The payout the store's last deploy recorded, if it is an address."""
    address = _recorded(target).get("address")
    return address if isinstance(address, str) and WALLET.fullmatch(address) else None


def _put_wallet(wrangler: str, target: Path, wallet: str) -> None:
    _run(
        (wrangler, "secret", "put", "LORE_WALLET"),
        target,
        input=wallet + "\n",
        fail="Lore couldn't set your store's payout address",
    )


def _restore_wallet(
    wrangler: str, target: Path, wallet: str, previous: str | None
) -> None:
    """Put the store's earlier payout back after the rest of a change failed,
    or say plainly, in the words the desktop app passes on, that it could not."""
    if previous is not None:
        try:
            _put_wallet(wrangler, target, previous)
            return
        except OSError:
            pass
    warn(
        f"Your store may be half-updated: it now pays {wallet} on its old "
        "network. Open your store again to finish."
    )


def _record_payout(target: Path, wallet: str | None, network: str | None) -> None:
    """Keep where this store pays out, and on which network, beside its code: the
    desktop app shows the owner exactly this before a redeploy and deploys it
    again, and the agent can neither read nor write it there. Every deploy that
    gets this far rewrites it, a wallet-less one keeping the recorded address.
    A store that sells by card alone has no address, so only its network is kept."""
    path = target / PAYOUT
    kept = _recorded(target)
    address = wallet or kept.get("address")
    if address is not None and (
        not isinstance(address, str) or not WALLET.fullmatch(address)
    ):
        return
    chosen = network or kept.get("network")
    if address is None and chosen is None:
        return
    _replace(path, json.dumps({"address": address, "network": chosen}))


def install(target: Path) -> None:
    """Install the store's packages from its own folder and nothing else: no npm
    settings from any folder above it, from the user, or global, and no install
    scripts (wrangler's platform binaries come as plain optional packages).
    Marked done only once wrangler is there."""
    (target / INSTALLED).unlink(missing_ok=True)
    # Taken before npm runs, since npm may rewrite the lockfile it was handed.
    asked = _packages(target)
    # npm refuses one file as both, so each gets its own empty one.
    user, shared = target / ".npmrc-user", target / ".npmrc-global"
    for empty in (user, shared):
        empty.write_text("")
        empty.chmod(0o600)
    _run(
        (
            "npm",
            "install",
            "--no-fund",
            "--no-audit",
            "--ignore-scripts",
            "--prefix",
            str(target),
            "--userconfig",
            str(user),
            "--globalconfig",
            str(shared),
        ),
        target,
        fail="npm install failed",
    )
    if not (target / WRANGLER).exists():
        raise OSError("npm install finished without wrangler; run it again")
    (target / INSTALLED).write_text(asked)


def tools() -> Path:
    """The store folder with its packages installed. An unfinished install is
    finished, and a store set up before it moved out of Lore's home is rebuilt
    here, once, whichever of the app's checks gets there first."""
    target = store_folder()
    if installed(target):
        return target
    with store_lock():
        if not installed(target):
            if not _kept_id(target / "wrangler.jsonc"):
                raise ValueError(
                    "no deployed node on this machine; open your store first"
                )
            materialize(0.0)
            install(target)
    return target


def _run(
    args: tuple[str, ...],
    cwd: Path,
    *,
    fail: str | None = None,
    interactive: bool = False,
    input: str | None = None,
    retry: bool = False,
    timeout: float = SUBPROCESS_TIMEOUT_S,
) -> subprocess.CompletedProcess[str]:
    """Run one tool. `retry` gives a refused request one more try after a
    pause, the way a push does: Cloudflare has refused the first request after
    wrangler refreshed its sign-in and accepted the next one moments later.

    Bounded by `timeout` either way: nothing here may prompt interactively for
    something the caller never supplied, so stdin is closed unless `input` is
    given, and a wedged subprocess is killed and reported rather than left to
    hang the caller (the desktop agent's turn, a terminal session) forever
    (MON-023)."""
    attempts = 2 if retry else 1
    for attempt in range(attempts):
        try:
            result = subprocess.run(
                args,
                cwd=cwd,
                input=input,
                stdin=None if input is not None else subprocess.DEVNULL,
                capture_output=not interactive,
                text=True,
                timeout=timeout,
            )
        except subprocess.TimeoutExpired as error:
            raise OSError(
                f"{fail or ' '.join(args)} timed out after {timeout:.0f}s:\n"
                f"{_timeout_detail(error)}"
            ) from error
        if result.returncode == 0:
            break
        if attempt < attempts - 1:
            time.sleep(3)
    if fail is not None and result.returncode:
        raise OSError(f"{fail}:\n{_detail(result)}")
    return result


def _detail(result: subprocess.CompletedProcess[str]) -> str:
    """The tail of both streams; or, when wrangler printed a refusal as JSON
    (its `--json` mode does, so the last line is a lone brace), Cloudflare's
    own sentence on one line without the account and database path."""
    try:
        error = json.loads(result.stdout or "")["error"]
        parts = (error["text"], *(note["text"] for note in error.get("notes", [])))
        return re.sub(r"\s*\([^)]*\)", "", " ".join(parts))
    except (ValueError, KeyError, TypeError):
        output = re.sub(
            r"\x1b\[[0-9;]*m", "", f"{result.stderr or ''}{result.stdout or ''}"
        )
        # Wrangler ends a refusal with its help text and a bug-report footer; its ✘ line says why.
        refusal = re.search(r"✘ \[ERROR\] (.+)", output)
        return refusal.group(1).strip() if refusal else output.strip()[-2000:]


def _timeout_detail(error: subprocess.TimeoutExpired) -> str:
    """Whatever partial output a killed subprocess produced before it was cut
    off — `TimeoutExpired.stdout`/`.stderr` hold only what had already been
    captured, same shape as `_detail`'s tail-of-both-streams."""
    stdout = error.stdout if isinstance(error.stdout, str) else ""
    stderr = error.stderr if isinstance(error.stderr, str) else ""
    return f"{stderr}{stdout}".strip()[-2000:]


def _ensure_d1(
    wrangler: str, target: Path
) -> Literal["created", "adopted", "recorded"]:
    """Resolve the shipped database_id placeholder against the owner's account.

    Wrangler validates D1 bindings at deploy time, so the placeholder must
    become a real id first. Idempotent: if the database already exists (a
    re-materialize reset this config, say) *and* this installation has
    deployed a node before, its id is recovered via `d1 list`.

    A fresh installation (no `node_url` recorded locally) that still finds an
    existing `lore-publications` database is a different situation: the
    signed-in Cloudflare account already has someone else's live node. A
    dogfood sandbox signed into the owner's own real account is exactly this
    case (#257) — adopting that database here would point this deploy's
    Worker at it, and the push that follows replaces its publications
    wholesale with this installation's (empty) local set. Refuse instead of
    silently adopting it.
    """
    config = target / "wrangler.jsonc"
    text = config.read_text()
    if D1_PLACEHOLDER not in text:
        return "recorded"
    muted("Creating the publications database (one-time)...")
    created = _run((wrangler, "d1", "create", D1_NAME), target)
    output = f"{created.stdout or ''}{created.stderr or ''}"
    # Some wrangler versions say so and still exit 0; the words decide, never the exit code alone.
    already_existed = "already exists" in output.lower()
    if created.returncode and not already_existed:
        # The first request to Cloudflare: an unverified email is refused here first.
        raise StoreFailed.of(
            OSError(f"Lore couldn't make your store's database:\n{_detail(created)}"),
            output,
        )
    # `d1 create` prints a config snippet; the id format survives wrangler's
    # TOML-vs-JSON output changes, so match the value rather than the syntax.
    match = re.search(r'database_id[":\s=]+([0-9a-fA-F-]{32,36})', output)
    database_id = match.group(1) if match else None
    if database_id is None:
        listing = _run((wrangler, "d1", "list", "--json"), target)
        try:
            entries = json.loads(listing.stdout or "[]")
        except ValueError:
            entries = []
        database_id = next(
            (e.get("uuid") for e in entries if e.get("name") == D1_NAME), None
        )
    if not database_id:
        raise OSError(
            f"could not determine the {D1_NAME} database id; run "
            f"`npx wrangler d1 list` in {target} and paste it into wrangler.jsonc"
        )
    if already_existed and not os.environ.get("LORE_ADOPT_EXISTING_D1"):
        with Store() as store:
            known_node = store.setting("node_url", None)
        if not known_node:
            raise StoreFailed(
                "exists_elsewhere",
                f"a {D1_NAME} database already exists on this Cloudflare account, "
                f"but this installation ({home()}) has never deployed a node before "
                "— adopting it would point this deploy at a database it does not "
                "own, and the push that follows would replace its publications "
                "with this installation's own (likely empty) local set. If this "
                "account really is yours and you are recovering lost local state, "
                f"confirm the id with `npx wrangler d1 list` in {target} and paste "
                "it into wrangler.jsonc yourself, or rerun with "
                "LORE_ADOPT_EXISTING_D1=1 set.",
            )
    if not already_existed:
        # A database made in this run is a new store: it sells nothing until a
        # full deploy's push opens it. Written before its id, so a write that
        # fails leaves no recorded database a retry could take for an older
        # store; guarded, so an explicit choice written meanwhile is never
        # overwritten (XC-069).
        with Store() as store:
            store.set_setting_if_unset(SELLING_SETTING, False)
    config.write_text(text.replace(D1_PLACEHOLDER, database_id))
    return "adopted" if already_existed else "created"


def _staged() -> Path:
    """The store folder with wrangler in it, staged and installed if it isn't yet."""
    target = store_folder()
    with store_lock():
        if not (target / "package.json").exists():
            target = materialize(0.0)
        if not installed(target):
            muted("Installing dependencies (the first run can take a minute)...")
            install(target)
    return target


def login() -> int:
    """Sign in to Cloudflare from the owner's browser.

    Prints the link to open (the desktop app opens it itself), waits for
    Cloudflare's callback, then says who is signed in."""
    if not shutil.which("npm"):
        raise OSError(NEEDS_NODE)
    target = _staged()
    wrangler = target / WRANGLER
    sys.stdout.flush()
    _run((str(wrangler), "login", "--browser=false"), target, interactive=True)
    # An interrupted login still exits 0; only whoami knows whether it landed.
    who = _run((str(wrangler), "whoami"), target)
    if who.returncode or "not authenticated" in f"{who.stdout}{who.stderr}".lower():
        raise OSError("Cloudflare sign-in did not complete")
    email = re.search(r"associated with the email (\S+)", who.stdout or "")
    success(f"Signed in to Cloudflare as {email.group(1) if email else 'your account'}")
    return 0


def _read(query: str, fail: str) -> list[dict[str, object]]:
    """Run `query` on the node's database through the owner's Cloudflare login,
    the same way `lore push` writes it, and return its last statement's rows."""
    return _read_all(query, fail)[-1]


def _read_all(query: str, fail: str) -> list[list[dict[str, object]]]:
    """Every statement's rows, in order, from one run of `query`."""
    target = tools()
    wrangler = target / WRANGLER
    result = _run(
        (
            str(wrangler),
            "d1",
            "execute",
            D1_NAME,
            "--remote",
            "--json",
            "--command",
            query,
        ),
        target,
        fail=fail,
        retry=True,
    )
    return [statement["results"] for statement in json.loads(result.stdout)]


def sales() -> list[Sale]:
    """Read the node's sales ledger."""
    return SALES.validate_python(_read(SALES_QUERY, "reading sales failed"))


def views() -> list[PageViews]:
    """Read how often each piece's page was opened."""
    return VIEWS.validate_python(_read(VIEWS_QUERY, "reading page views failed"))


def secret(name: str, value: str) -> int:
    """Vault one Coinbase credential on the node."""
    if name not in SECRETS:
        raise ValueError(f"the node keeps only {' and '.join(SECRETS)}, not {name}")
    if not value:
        raise ValueError(f"no value given for {name}")
    target = tools()
    wrangler = target / WRANGLER
    _run(
        (str(wrangler), "secret", "put", name),
        target,
        input=value + "\n",
        fail=f"storing {name} failed",
    )
    success(f"Stored {name} in Cloudflare's vault")
    return 0


def _token(wrangler: str, target: Path) -> str | None:
    """The token wrangler signs in with, for Cloudflare's API; none if it gives none."""
    said = _run((wrangler, "auth", "token", "--json"), target)
    try:
        answer = json.loads(said.stdout or "")
    except ValueError:
        return None
    token = answer.get("token") if isinstance(answer, dict) else None
    return token if isinstance(token, str) and token else None


def accounts() -> list[Account]:
    """The Cloudflare accounts the owner's sign-in can put the store on."""
    target = _staged()
    token = _token(str(target / WRANGLER), target)
    if token is None:
        raise StoreFailed("not_signed_in", NOT_SIGNED_IN)
    return Cloudflare(token).accounts()


def choose_account(account: str) -> None:
    """Remember which of the owner's Cloudflare accounts the store goes on."""
    if not ACCOUNT_ID.fullmatch(account):
        raise ValueError("a Cloudflare account id is 32 lowercase hex characters")
    with Store() as store:
        store.set_setting(ACCOUNT_SETTING, account)


def _account(cloudflare: Cloudflare, config: Path) -> str | None:
    """The account the store goes on: the one wrangler is told to use, the one
    the owner chose, or the only one there is. Several, none chosen, and the
    owner is asked, once."""
    if os.environ.get("CLOUDFLARE_ACCOUNT_ID"):
        return os.environ["CLOUDFLARE_ACCOUNT_ID"]
    with Store() as store:
        chosen = store.setting(ACCOUNT_SETTING, None)
    found = cloudflare.accounts()
    if any(account.id == chosen for account in found):
        return str(chosen)
    if len(found) > 1:
        names = ", ".join(account.name for account in found)
        raise StoreFailed("many_accounts", MANY_ACCOUNTS, f"accounts: {names}")
    if chosen is not None:
        # The owner signed in elsewhere since choosing; that choice no longer applies.
        with Store() as store:
            store.set_setting(ACCOUNT_SETTING, None)
        _replace(config, _pinned(config.read_text(), None))
    return found[0].id if found else None


def _ready_account(wrangler: str, target: Path) -> bool:
    """Settle, through Cloudflare's API, what wrangler would otherwise ask with
    no one at its prompt (XC-087): which account, and a workers.dev address for
    an account that has never had one. True when that address is brand new.

    Best-effort beyond those: if the check itself can't run, the deploy goes on
    and wrangler says what is wrong in its own words."""
    try:
        token = _token(wrangler, target)
        if token is None:
            return False
        cloudflare = Cloudflare(token)
        account = _account(cloudflare, target / "wrangler.jsonc")
        if account is None or cloudflare.subdomain(account) is not None:
            return False
        muted("Giving your Cloudflare account a web address (one-time)...")
        owner = blueprint.load_blueprint()
        name = owner.get("name") if owner else None
        made = cloudflare.register(
            account, subdomain_name(name if isinstance(name, str) else "")
        )
        _store_log(f"made the account's workers.dev address: {made}")
        return True
    except StoreFailed:
        raise
    except CloudflareError as error:
        if error.unverified:
            raise StoreFailed("email_unverified", VERIFY_EMAIL, str(error)) from error
        _store_log(f"checking the Cloudflare account: {error}")
    except (OSError, ValueError, KeyError, TypeError) as error:
        _store_log(f"checking the Cloudflare account: {error!r}")
    return False


def deploy(
    wallet: str | None, network: str | None = None, *, inbox_only: bool = False
) -> int:
    """Check the preconditions, then run and record one deploy.

    `inbox_only` puts the store online for the owner's own agents before
    anything is for sale (XC-069): only the Cloudflare sign-in is needed, and
    the price and payout guards wait for the deploy that opens it for sale."""
    if inbox_only and (wallet or network):
        raise ValueError(
            "--inbox-only puts your store online with nothing for sale, so it takes "
            "no payout address or network; leave them off, or drop --inbox-only to sell"
        )
    if wallet and not WALLET.fullmatch(wallet):
        raise ValueError(
            "wallet must be a public EVM address: 0x plus 40 hex characters"
        )
    if not shutil.which("npm"):
        raise OSError(NEEDS_NODE)

    with Store() as store:
        configured_price = store.setting("price_usd", None)
        already_selling = selling(store)
        chosen = choice(store)
    if inbox_only and os.environ.get("LORE_ADOPT_EXISTING_D1") and chosen is not False:
        # Reconnecting an existing store starts from no address, which an
        # inbox-only deploy would take for a new store and close for sale.
        raise ValueError(
            "You're reconnecting an existing store; run the full store setup so it keeps selling."
        )
    if inbox_only:
        # A store open for sale keeps charging its owner's price, so that price
        # must be one it can charge, exactly as for a full deploy.
        price = (
            _valid_price(configured_price)
            if already_selling
            else _priced(configured_price)
        )
        return _recorded_deploy(price, None, None, inbox_only=True)
    return _recorded_deploy(_valid_price(configured_price), wallet, network)


def _valid_price(configured_price: object) -> float:
    """The owner's price, or a plain refusal naming what to set."""
    if configured_price is None:
        raise ValueError(
            "no publication price is set; set one with `lore price <USD>` before deploying"
        )
    if isinstance(configured_price, bool) or not isinstance(
        configured_price, (int, float)
    ):
        raise ValueError(
            f"the publication price must be a number of at least ${MINIMUM_PRICE:.6f}; "
            "set it with `lore price <USD>` and rerun"
        )
    if not math.isfinite(configured_price):
        raise ValueError(
            f"the publication price must be a number of at least ${MINIMUM_PRICE:.6f}; "
            "set it with `lore price <USD>` and rerun"
        )
    if configured_price == 0:
        raise ValueError(
            "publications are free (`lore price 0`), which needs no deployed node; "
            "set a positive price with `lore price <USD>` to deploy, or stop here"
        )
    # The floor keeps the guard and the price formatter in agreement: anything
    # below 1e-6 renders as `PRICE_USD = 0`, a paid node that charges nothing.
    if configured_price < MINIMUM_PRICE:
        raise ValueError(
            f"the publication price must be a number of at least ${MINIMUM_PRICE:.6f}; "
            "set it with `lore price <USD>` and rerun"
        )
    return float(configured_price)


def _priced(configured: object) -> float | None:
    """The owner's price when it is one the node can charge, else none."""
    if isinstance(configured, bool) or not isinstance(configured, (int, float)):
        return None
    priced = math.isfinite(configured) and configured >= MINIMUM_PRICE
    return float(configured) if priced else None


def _recorded_deploy(
    price: float | None,
    wallet: str | None,
    network: str | None,
    *,
    inbox_only: bool = False,
) -> int:
    """Run one deploy as a recorded job.

    Recorded from here, past the argument and price guards: a refused
    precondition is validation the owner sees immediately, not a run. This is
    the one seam both deploy paths cross — the desktop app reaches it through
    the agent's shell, a terminal reaches it through the CLI."""
    with Store() as store:
        job_id = store.start_job(
            JobKind.DEPLOY.value, owner_pid=os.getpid(), timeout_minutes=60
        )
    # Only ever a literal from the summary vocabulary. Deploy failures carry raw
    # subprocess output naming accounts, paths, and commands; none of it may
    # reach owner history, so the cause stays in the raised error alone.
    outcome = ("failed", "failed")
    usage.record("store.attempted")
    try:
        result = _deploy(price, wallet, network, inbox_only=inbox_only)
    except (OSError, ValueError) as error:
        # The owner hears one plain line; the full story stays in the store log,
        # and usage hears only which of a few known causes it was (XC-085).
        failed = StoreFailed.of(error)
        failed.log()
        usage.record("store.failed", failed.reason)
        if isinstance(error, OSError):
            raise failed from error
        raise
    else:
        with Store() as store:
            open_for_sale = choice(store) is not False
        outcome = (
            "succeeded",
            f"deployed_{network}"
            if network in NETWORKS
            else "deployed"
            if open_for_sale
            else "deployed_inbox",
        )
        return result
    finally:
        with Store() as store:
            store.finish_job(job_id, outcome[0], summary=outcome[1])


def _deploy(
    configured_price: float | None,
    wallet: str | None,
    network: str | None = None,
    *,
    inbox_only: bool = False,
) -> int:
    """Materialize, authenticate, ensure D1, deploy, set the payout secret,
    push the active publications, smoke-check.

    Whether the store sells is the owner's choice, `node_selling` (see
    SELLING_SETTING): a deploy that creates the store's database marks it not
    selling, and only a full deploy whose push succeeded marks it selling."""
    with store_lock():
        target = materialize(configured_price)
        muted(f"Node source staged at {target}")
        if not current(target):
            muted("Installing dependencies (the first run can take a minute)...")
            install(target)
    wrangler = str(target / WRANGLER)

    # Some wrangler versions exit 0 while logged out and only say so in text.
    who = _run((wrangler, "whoami"), target)
    if who.returncode or "not authenticated" in f"{who.stdout}{who.stderr}".lower():
        # The desktop agent's shell has no owner at it; the app signs in itself.
        if os.environ.get("LORE_UNATTENDED"):
            raise StoreFailed("not_signed_in", NOT_SIGNED_IN)
        muted("Opening Cloudflare login in your browser (free tier is enough)...")
        if _run((wrangler, "login"), target, interactive=True).returncode:
            raise OSError(
                f"Cloudflare login failed; run `npx wrangler login` in {target}"
            )
    fresh = _ready_account(wrangler, target)

    if not wallet and not inbox_only and not takes_cards():
        # This check exists so a missing payout address costs seconds, not a
        # deploy. A listing that failed says nothing about the wallet, so it
        # stops the deploy rather than being read as "no wallet". Card
        # payments are enough on their own: such a store sells by card alone.
        listing = _run(
            (wrangler, "secret", "list"),
            target,
            fail="reading your store's settings from Cloudflare failed",
        )
        if "LORE_WALLET" not in (listing.stdout or ""):
            raise ValueError(
                "your store has no way to be paid yet; turn on card payments "
                "(lore cards connect) or rerun with --wallet 0x<your public address>"
            )

    _ensure_d1(wrangler, target)
    deployed = _run((wrangler, "deploy"), target)
    # A brand-new Cloudflare account can't run Workers until its email is verified;
    # the database is made and recorded by now, so a retry afterwards picks it up.
    if deployed.returncode:
        raise StoreFailed.of(
            OSError(f"deploy failed:\n{_detail(deployed)}"),
            f"{deployed.stderr or ''}{deployed.stdout or ''}",
        )
    print(deployed.stdout.strip())
    _record_store(target)

    # Wrangler colourises under TTY-ish environments; strip escapes so \S+
    # cannot swallow them into the matched address.
    plain = re.sub(r"\x1b\[[0-9;]*m", "", deployed.stdout)
    match = re.search(r"https://\S+\.workers\.dev", plain)
    url = match.group(0).rstrip("/") + "/mcp" if match else None
    if url:
        # Recorded before the secret put: if that step fails, the node is
        # live and `lore status` must still be able to recover it.
        with Store() as store:
            store.set_setting("node_url", url)

    # The wallet first, then the network: a wallet that fails to set leaves
    # both as they were, and a network that fails to set puts the old wallet
    # back, so the store never pays a new address on its old network or the
    # old one on its new. A brand-new node waits on the test network (the
    # Worker's default) for the moment between the two.
    previous = _recorded_address(target)
    if wallet:
        # Setting a secret redeploys, so the smoke check below sees a
        # configured node even on the very first deploy.
        _put_wallet(wrangler, target, wallet)
    if network:
        # Real money settles keyless unless the owner vaulted a Coinbase pair
        # (`lore node secret`); half a pair refuses to start and the smoke
        # check below says so.
        try:
            _run(
                (wrangler, "secret", "put", "LORE_NETWORK"),
                target,
                input=NETWORKS[network] + "\n",
                fail="Lore couldn't switch your store's network",
            )
        except OSError:
            if wallet and wallet != previous:
                _restore_wallet(wrangler, target, wallet, previous)
            raise
    _record_payout(target, wallet, network)

    # First push creates the publications table (CREATE TABLE IF NOT EXISTS),
    # so discover works before the owner has published anything; an empty
    # active set is a valid state, and re-pushing is idempotent. A full deploy
    # has the price, network and payout in place, so its push opens the store
    # for sale; only once that push landed does the owner's choice say so.
    from .cli import push_job  # local import: cli imports this module at top level

    push_job(target, False, opening=not inbox_only)
    with Store() as store:
        if not inbox_only:
            store.set_setting(SELLING_SETTING, True)
        open_for_sale = selling(store)

    if not url:
        # The deploy succeeded, so no workers.dev address in the output means
        # a custom route, not a dead node — the recorded URL stays as it was.
        muted(
            "Deployed, but wrangler printed no workers.dev URL (custom route?); "
            "kept the recorded node URL — smoke-check manually."
        )
        return 0

    # The same plain HTTPS probe the app trusts for its store status; the
    # Node smoke script needs a local socket the desktop agent's shell denies.
    from .snapshot import remote_manifest  # local import, as push_job above

    # A workers.dev address made this run takes a few minutes to answer.
    probes = FRESH_PROBES if fresh else 1
    for probe in range(probes):
        try:
            manifest = remote_manifest(url)
            break
        except (OSError, ValueError, KeyError, IndexError, TypeError) as error:
            if probe < probes - 1:
                time.sleep(10)
                continue
            raise OSError(
                f"deployed, but {url} did not answer discover: {error}\n"
                f"Stream the live error with `npx wrangler tail` in {target}"
            ) from error
    count = sum(len(entries) for entries in manifest.topics.values())
    if not open_for_sale:
        success(f"Online: {url} · ready for your agents, nothing for sale")
        return 0
    success(f"Live: {url} · {count} publication{'s' if count != 1 else ''}")
    return 0
