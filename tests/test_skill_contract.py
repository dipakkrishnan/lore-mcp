"""Skills are executable documentation; hold them to the code they drive.

Each skill file is an experience run verbatim
by an agent in front of an owner. A command it names that does not exist, or a skill
the installer never copies, fails in the middle of someone's setup, where nothing else
catches them. These tests pin every skill against the real parser and the real install
path so that drift breaks a build instead of an owner's evening.

The payment skill adds one more thing to pin, because it is the only one that stands
next to a secret: no line of it may be capable of carrying that secret into a
transcript.
"""

from __future__ import annotations

import argparse
import json
import re
import unittest
from pathlib import Path

from lore import blueprint, onboarding
from lore.cli import parser

ROOT = Path(__file__).resolve().parent.parent
PLUGIN = ROOT / "plugins/lore"
OWNER_SKILLS = PLUGIN / "skills"
MAINTAINER_SKILLS = ROOT / "skills"
README = ROOT / "README.md"
INSTALLER = ROOT / "install.sh"

# Skills shipped to owners, as opposed to the repo's own maintenance skills. The
# installer ships exactly this set, so the prefix is a contract, not a convention.
OWNER_SKILL_GLOB = "lore-*"
EXTERNAL_SKILLS = {
    "lore-capture",
    "lore-enable-payments",
    "lore-onboard",
    "lore-publish",
}

# A `lore <command> [subcommand]` invocation, anchored to the start of a shell line or
# an inline code span so that prose about "your lore" is never mistaken for a command.
INVOCATION = re.compile(
    r"^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*lore\s+([a-z][a-z-]*)(?:\s+([a-z][a-z-]*))?"
)

# Ways a payment secret could reach a transcript: assigned in a snippet the owner is
# told to run, or pasted as a literal key. On the Worker path the only secret near
# this flow is the test buyer's key, which belongs in `.buyer.env`, edited by the
# owner — never in a command an agent composes.
SECRET_LEAKS = (
    (re.compile(r"CDP_API_KEY_SECRET\s*="), "assigns the CDP key secret"),
    (re.compile(r"BUYER_TEST_PRIVATE_KEY\s*="), "assigns the test buyer key"),
    (re.compile(r"--(?:secret|private-key|key-secret)\b"), "takes a secret as a flag"),
    (re.compile(r"0x[0-9a-fA-F]{64}"), "contains something shaped like a private key"),
)


def _skill_files() -> list[Path]:
    return sorted(OWNER_SKILLS.glob("*/SKILL.md")) + sorted(
        MAINTAINER_SKILLS.glob("*/SKILL.md")
    )


def _owner_skills() -> list[Path]:
    return sorted(path for path in OWNER_SKILLS.glob(OWNER_SKILL_GLOB) if path.is_dir())


def _markdown_files() -> list[Path]:
    return sorted(OWNER_SKILLS.glob("*/*.md")) + sorted(
        MAINTAINER_SKILLS.glob("*/*.md")
    )


def _documents(skill: Path) -> list[Path]:
    """Every markdown file a skill folder ships, since an agent may be sent to any."""
    return sorted(skill.glob("*.md"))


def _invocations(text: str) -> list[tuple[str, str]]:
    """Return every Lore command a reader would actually type from this document."""
    snippets = [
        line
        for block in re.findall(r"```[a-z]*\n(.*?)```", text, re.DOTALL)
        for line in block.splitlines()
    ]
    snippets.extend(re.findall(r"`([^`\n]+)`", text))
    return [
        match.groups() for snippet in snippets if (match := INVOCATION.match(snippet))
    ]


def _subcommands(command: argparse.ArgumentParser) -> dict[str, set[str]]:
    """Map every command the CLI accepts to the subcommands it accepts under it."""
    found: dict[str, set[str]] = {}
    for action in command._actions:
        if not isinstance(action, argparse._SubParsersAction):
            continue
        for name, sub in action.choices.items():
            found[name] = set(_subcommands(sub))
    return found


def _frontmatter(text: str) -> dict[str, str]:
    front = text.split("---", 2)[1]
    return {
        key.strip(): value.strip()
        for key, _, value in (line.partition(":") for line in front.splitlines())
        if key.strip() in {"name", "description"}
    }


class SkillContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.commands = _subcommands(parser())

    def test_every_command_the_docs_tell_you_to_run_exists(self) -> None:
        """A skill that names a command Lore does not have strands the owner mid-setup."""
        sources = [(README.relative_to(ROOT), README)]
        sources += [(path.relative_to(ROOT), path) for path in _markdown_files()]
        for label, path in sources:
            text = path.read_text(encoding="utf-8")
            for command, sub in _invocations(text):
                with self.subTest(
                    source=str(label), command=f"lore {command} {sub}".strip()
                ):
                    self.assertIn(command, self.commands)
                    if sub and self.commands[command]:
                        self.assertIn(sub, self.commands[command])

    def test_every_skill_is_named_after_its_folder(self) -> None:
        """Agents resolve a skill by name; a mismatch makes it unreachable."""
        for path in _skill_files():
            with self.subTest(skill=path.parent.name):
                self.assertEqual(
                    _frontmatter(path.read_text(encoding="utf-8"))["name"],
                    path.parent.name,
                )

    def test_external_plugin_contains_only_owner_skills(self) -> None:
        self.assertEqual(
            {path.name for path in OWNER_SKILLS.iterdir() if path.is_dir()},
            EXTERNAL_SKILLS,
        )
        self.assertTrue((PLUGIN / ".claude-plugin/plugin.json").is_file())
        self.assertTrue((PLUGIN / ".codex-plugin/plugin.json").is_file())

        claude = json.loads((ROOT / ".claude-plugin/marketplace.json").read_text())
        codex = json.loads((ROOT / ".agents/plugins/marketplace.json").read_text())
        self.assertEqual(claude["plugins"][0]["source"], "./plugins/lore")
        self.assertEqual(codex["plugins"][0]["source"]["path"], "./plugins/lore")

    def test_every_skill_says_when_to_use_it(self) -> None:
        """A description with no trigger phrasing is a skill that never fires."""
        for path in _skill_files():
            description = _frontmatter(path.read_text(encoding="utf-8")).get(
                "description", ""
            )
            with self.subTest(skill=path.parent.name):
                self.assertIn("use when", description.lower())

    def test_every_skill_has_host_metadata(self) -> None:
        """Skills should render and invoke cleanly in hosts, not only via symlinks."""
        for path in _skill_files():
            name = path.parent.name
            metadata = path.parent / "agents/openai.yaml"
            with self.subTest(skill=name):
                self.assertTrue(metadata.is_file())
                text = metadata.read_text(encoding="utf-8")
                fields = dict(re.findall(r'^  (\w+): "([^"]+)"$', text, re.MULTILINE))
                self.assertEqual(
                    set(fields),
                    {"display_name", "short_description", "default_prompt"},
                )
                self.assertGreaterEqual(len(fields["short_description"]), 25)
                self.assertLessEqual(len(fields["short_description"]), 64)
                self.assertIn(f"${name}", fields["default_prompt"])
                for host in (".agents", ".claude"):
                    linked = ROOT / host / "skills" / name
                    self.assertTrue(linked.is_dir())
                    self.assertEqual(linked.resolve(), path.parent.resolve())

    def test_skills_handle_host_prompt_syntax(self) -> None:
        for path in _markdown_files():
            text = path.read_text(encoding="utf-8")
            with self.subTest(skill=path.parent.name):
                self.assertNotIn("$ARGUMENTS", text)
        for skill in _owner_skills():
            text = (skill / "SKILL.md").read_text(encoding="utf-8")
            with self.subTest(skill=skill.name):
                self.assertIn("Claude Code, use `AskUserQuestion`", text)
                self.assertIn("In Codex, ask directly in chat", text)
                self.assertIn("Never block because a named question", text)

    def test_every_owner_skill_reaches_both_places_an_agent_looks(self) -> None:
        """Discovery is all-or-nothing: an unlinked or uncopied skill simply never runs."""
        installer = INSTALLER.read_text(encoding="utf-8")
        self.assertIn(f"plugins/lore/skills/{OWNER_SKILL_GLOB}", installer)
        for home in ("$HOME/.agents/skills", "$HOME/.claude/skills"):
            with self.subTest(destination=home):
                self.assertIn(home, installer)

        for skill in _owner_skills():
            with self.subTest(skill=skill.name):
                # The installer ships a glob; a skill outside it is silently skipped.
                self.assertTrue(skill.match(f"*/{OWNER_SKILL_GLOB}"))
                linked = ROOT / ".claude/skills" / skill.name
                self.assertTrue(
                    linked.is_dir(), f"{skill.name} is not linked for this repo"
                )
                self.assertEqual(linked.resolve(), skill.resolve())

    def test_every_skill_a_skill_routes_to_exists(self) -> None:
        """A hand-off to a skill that does not ship strands the owner at the boundary.

        Skills route to each other by name at their edges — onboarding offers the
        Monetize branch, payments routes to publishing. The reference is the contract:
        a named skill must exist, because the failure is an agent telling an owner to
        run something that is not installed.
        """
        shipped = {path.parent.name for path in _skill_files()}
        not_skills = {"lore-mcp"}  # the package, not a skill
        for path in _markdown_files():
            text = path.read_text(encoding="utf-8")
            for name in set(re.findall(r"\blore-[a-z][a-z-]*\b", text)) - not_skills:
                with self.subTest(source=str(path.relative_to(ROOT)), reference=name):
                    self.assertIn(name, shipped)

    def test_every_skill_local_reference_resolves(self) -> None:
        """A phase file the skill points at, or ships without naming, breaks mid-run."""
        for path in _skill_files():
            text = path.read_text(encoding="utf-8")
            siblings = set()
            for file in path.parent.iterdir():
                if file.name == "SKILL.md":
                    continue
                if file.is_dir():
                    with self.subTest(skill=path.parent.name, directory=file.name):
                        self.assertEqual(file.name, "agents")
                        self.assertEqual(
                            {child.name for child in file.iterdir()}, {"openai.yaml"}
                        )
                    continue
                siblings.add(file.name)
            for name in siblings:
                with self.subTest(skill=path.parent.name, file=name):
                    self.assertIn(name, text)
            for reference in set(re.findall(r"`([a-z][a-z0-9-]*\.md)`", text)):
                with self.subTest(skill=path.parent.name, reference=reference):
                    self.assertTrue((path.parent / reference).is_file())

    def test_no_skill_writes_a_lore_file_directly(self) -> None:
        """Direct writes are what the single-write-path rule exists to prevent."""
        for path in _markdown_files():
            for line in path.read_text(encoding="utf-8").splitlines():
                with self.subTest(
                    source=str(path.relative_to(ROOT)), line=line.strip()
                ):
                    self.assertNotRegex(
                        line.strip(),
                        r"^(cat|echo|printf|tee)\b.*>\s*[\"']?[~$]?/?\.?lore/",
                    )

    def test_no_skill_can_carry_a_payment_secret(self) -> None:
        """The one review finding that would silently regress on any future edit.

        An earlier draft of the payment skill collected credentials in conversation.
        That puts a payment secret into transcripts under `~/.claude/projects/` — the
        very files synthesis later reads — so the secret would end up in the memory
        library it exists to protect. The shape of that mistake is testable, so it is
        tested rather than trusted to review.
        """
        for path in _markdown_files():
            text = path.read_text(encoding="utf-8")
            for pattern, problem in SECRET_LEAKS:
                with self.subTest(source=str(path.relative_to(ROOT)), problem=problem):
                    found = pattern.search(text)
                    self.assertIsNone(
                        found, f"{problem}: {found.group(0) if found else ''}"
                    )

    def test_the_payment_skill_refuses_the_secret_out_loud(self) -> None:
        """Saying it is not enough, but not saying it guarantees someone pastes one."""
        skill = (
            (OWNER_SKILLS / "lore-enable-payments/SKILL.md")
            .read_text(encoding="utf-8")
            .lower()
        )
        # The buyer key goes into `.buyer.env`, edited by the owner in their own
        # editor — never pasted into the conversation an agent later synthesizes.
        self.assertIn(".buyer.env", skill)
        self.assertIn("themselves", skill)
        for promise in ("never holds", "test network", "explicit"):
            with self.subTest(promise=promise):
                self.assertIn(promise, skill)

    def test_the_payment_skill_can_start_from_no_wallet_at_all(self) -> None:
        """ "Walk them to a wallet" is not an instruction anyone can follow."""
        skill = (OWNER_SKILLS / "lore-enable-payments/SKILL.md").read_text(
            encoding="utf-8"
        )
        lowered = skill.lower()
        # A concrete origin for each account the owner does not yet have.
        self.assertIn("coinbase.com/wallet", lowered)
        self.assertIn("portal.cdp.coinbase.com", lowered)
        # And a funded test payer that is never the payout wallet.
        self.assertIn("faucet", lowered)
        self.assertIn("never the payout wallet", lowered)

    def test_the_payment_skill_refuses_a_recovery_phrase(self) -> None:
        """The one secret worse than an API key to land in a transcript."""
        skill = (
            (OWNER_SKILLS / "lore-enable-payments/SKILL.md")
            .read_text(encoding="utf-8")
            .lower()
        )
        self.assertIn("recovery phrase", skill)
        # Every sentence mentioning it must either warn or refuse — none may invite it.
        mentions = [
            sentence
            for sentence in re.split(r"(?<=[.!?])\s+", skill)
            if "recovery phrase" in sentence
        ]
        self.assertGreaterEqual(
            len(mentions), 2, "the phrase is mentioned but not guarded"
        )
        self.assertTrue(
            any("never" in sentence for sentence in mentions),
            "no sentence refuses to handle the recovery phrase",
        )
        # The failure mode is inviting the owner to hand it over. A refusal that
        # happens to contain "paste" ("never accept it if they paste it") is not that,
        # so negated sentences are exempt.
        invitation = re.compile(
            r"\b(paste|share|send|enter|type|give)\b[^.\n]{0,60}(recovery|seed) phrase"
        )
        for sentence in mentions:
            if re.search(r"\b(never|not|don't|do not)\b", sentence):
                continue
            with self.subTest(sentence=sentence.strip()[:80]):
                self.assertNotRegex(sentence, invitation)

    def test_the_payment_skill_keeps_free_a_first_class_outcome(self) -> None:
        """`useful before monetized` is a product principle, not a footnote."""
        skill = (
            (OWNER_SKILLS / "lore-enable-payments/SKILL.md")
            .read_text(encoding="utf-8")
            .lower()
        )
        self.assertIn("lore price 0", skill)
        self.assertIn("has not failed", skill)

    def test_owner_handoffs_offer_and_decline_paid_proxy_answers(self) -> None:
        onboard = " ".join(
            (OWNER_SKILLS / "lore-onboard/SKILL.md").read_text().lower().split()
        )
        publish = " ".join(
            (OWNER_SKILLS / "lore-publish/SKILL.md").read_text().lower().split()
        )
        payments = " ".join(
            (OWNER_SKILLS / "lore-enable-payments/SKILL.md").read_text().lower().split()
        )

        self.assertIn("only after a publication is approved", onboard)
        for product in ("`get`", "`answer`", "or also add"):
            self.assertIn(product, publish)
            self.assertIn(product, payments)
        for boundary in (
            "public behavior guidance",
            "not an api key",
            "does not mean the owner is present",
            "lore answer on <temporary-proxy-file> <per-answer-price>",
            "a rejection saves nothing",
            "publication-only, free, and private-only are complete outcomes",
        ):
            self.assertIn(boundary, payments)

    def test_onboarding_owns_the_runtime_install(self) -> None:
        skill = " ".join(
            (OWNER_SKILLS / "lore-onboard/SKILL.md").read_text().lower().split()
        )
        for boundary in (
            "ask permission to install it and wait",
            "never ask the owner to type, paste, or understand `curl`",
            "run `lore status` again",
            "only after it succeeds",
            "a refusal changes nothing",
        ):
            self.assertIn(boundary, skill)

    def test_capture_skill_requires_private_approval_before_publish_handoff(
        self,
    ) -> None:
        skill = (
            (OWNER_SKILLS / "lore-capture/SKILL.md").read_text(encoding="utf-8").lower()
        )
        for boundary in (
            "save nothing until the owner clearly approves",
            "stores every entry as `private`",
            "never edit `lore.db`",
            "lore-publish",
            "capture never creates a publication itself",
        ):
            with self.subTest(boundary=boundary):
                self.assertIn(boundary, skill)


if __name__ == "__main__":
    unittest.main()


# The onboarding skill carries contracts no other skill has: it restates the persona
# registry as markdown tables, assembles a JSON artifact `apply` validates, and is
# triggered by a phrase the CLI itself prints. Those live here rather than in the
# all-skills contract above, which deliberately knows nothing about any one skill.
ONBOARD = OWNER_SKILLS / "lore-onboard"
SKILL = ONBOARD / "SKILL.md"
INTERVIEW = ONBOARD / "persona-interview.md"


def _table(text: str, header_start: str) -> dict[str, list[str]]:
    """Read one markdown table into {row label: cells}, keyed by its header row."""
    lines = text.splitlines()
    start = next(
        index for index, line in enumerate(lines) if line.startswith(header_start)
    )
    rows: dict[str, list[str]] = {}
    for line in lines[start:]:
        if not line.startswith("|"):
            break
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        rows[cells[0]] = cells[1:]
    return rows


def _section(text: str, heading: str) -> str:
    """Return one markdown section, up to the next heading of the same level."""
    level = heading.split(" ")[0]
    start = text.index(heading)
    rest = text[start + len(heading) :]
    end = rest.find(f"\n{level} ")
    return rest if end == -1 else rest[:end]


class OnboardingSkillContractTest(unittest.TestCase):
    def setUp(self) -> None:
        self.skill = SKILL.read_text(encoding="utf-8")
        self.interview = INTERVIEW.read_text(encoding="utf-8")

    def test_the_interview_can_ask_about_every_persona_the_code_accepts(self) -> None:
        """Adding a persona in code without a question column ships an unusable archetype."""
        questions = _table(self.interview, "| Goal |")
        columns = {cell.lower() for cell in questions["Goal"]}
        structure = _table(self.interview, "| | Storyteller")
        crosswalk = _section(
            self.interview, "## Crosswalk (free text → canonical enum)"
        )

        self.assertEqual(
            {cell.lower() for cell in structure[""]}, set(blueprint.PERSONAS)
        )
        for persona in blueprint.PERSONAS:
            with self.subTest(persona=persona):
                self.assertIn(persona, columns)
                self.assertIn(f"`{persona}`", crosswalk)

    def test_the_structure_table_matches_the_persona_registry(self) -> None:
        """The table restates PERSONA_PROFILES; duplicated data drifts unless pinned."""
        structure = _table(self.interview, "| | Storyteller")
        personas = [cell.lower() for cell in structure[""]]
        rows = {
            "Default axis": "axis",
            "Outline section": "outline",
            "Focus section": "focus",
            "General section": "general",
            "Voice section": "voice",
        }
        for row, key in rows.items():
            for index, persona in enumerate(personas):
                profile = blueprint.PERSONA_PROFILES[persona]
                expected = (
                    profile["axis"] if key == "axis" else profile["section_labels"][key]
                )
                with self.subTest(row=row, persona=persona):
                    self.assertEqual(structure[row][index], expected)

    def test_every_organizing_axis_has_a_crosswalk_entry(self) -> None:
        """An axis with no phrasing to map from is an override the owner cannot request."""
        crosswalk = _section(
            self.interview, "## Crosswalk (free text → canonical enum)"
        )
        for axis in blueprint.AXES:
            with self.subTest(axis=axis):
                self.assertIn(f"`{axis}`", crosswalk)

    def test_the_blueprint_template_is_exactly_what_apply_accepts(self) -> None:
        """The skill assembles this shape verbatim; `apply` rejects any field it invents."""
        block = self.interview.split("```json", 1)[1].split("```", 1)[0]
        template = json.loads(block)
        self.assertEqual(set(template), set(blueprint.BlueprintInput.model_fields))

        # Placeholders stand in for owner answers; the enum-valued ones must be real.
        template["persona"] = "professor"
        template["organizing_axis"] = "theme"
        self.assertEqual(blueprint.normalize(template)["organizing_axis"], "theme")
        # The template says to omit the axis unless overridden — that must also apply.
        del template["organizing_axis"]
        self.assertEqual(blueprint.normalize(template)["organizing_axis"], "knowledge")

    def test_the_skill_documents_every_checkpoint_field(self) -> None:
        """An answer the skill never records is one the owner is asked for twice."""
        preconditions = _section(self.skill, "## 0. Preconditions")
        documented = set(re.findall(r"`([a-z0-9_]+)`", preconditions))
        self.assertEqual(onboarding.ACCEPTED_FIELDS - documented, set())

    def test_the_skill_triggers_on_the_phrase_the_cli_tells_people_to_say(self) -> None:
        """`lore setup` ends by quoting a phrase; a skill that ignores it never runs."""
        description = _frontmatter(self.skill)["description"].lower()
        self.assertIn(onboarding.TRIGGER.lower().rstrip("."), description)
