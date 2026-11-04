// APP-284: what a memory's sheet reads from its text: the title once, an agent's bookkeeping as properties or not at
// all, and every other memory exactly as it was.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { MemoryText } = require("../src/memorytext.js");

/** The shape Codex writes to ~/.codex/memories/MEMORY.md, which Lore imports as one memory titled by its first heading. */
const CODEX = `# Task Group: Lore MCP test maintenance and desktop CI optimization

scope: evidence-based deletion of low-signal tests while retaining product-boundary coverage
applies_to: cwd=/Users/someone/git/clones/lore-mcp; reuse_rule=recheck current branch, PR, CI state before applying

## Task 1: Prune low-value tests and optimize Python/desktop checks

### rollout_summary_files

- rollout_summaries/2026-10-26T12-54-50-agH1-lore_prune.md (cwd=/Users/someone/git/clones/lore-mcp, rollout_path=/Users/someone/.codex/sessions/2026/10/26/rollout-2026-10-26T08-54-50-01a1.jsonl, updated_at=2026-10-26T13:58:16+00:00, thread_id=01a17847-233c-7d11, partial; refreshed sharded CI pending)

### keywords

- PR #559, XC-043, pytest --durations, ci-edge.test.cjs

## Reusable knowledge

- Profile with \`uv run pytest -q --durations=80\`. [Task 1]

# Task Group: macOS Dock visibility restoration

scope: persistently restoring an auto-hidden Dock
applies_to: cwd=/Users/someone/Documents/Codex/2026-10-25/dock-fix during the observed task; reuse_rule=machine-specific

## Task 1: Disable Dock auto-hide persistently

### rollout_summary_files

- rollout_summaries/2026-10-27T01-00-00-dock.md (cwd=/Users/someone, rollout_path=/Users/someone/.codex/sessions/2026/10/27/rollout-dock.jsonl, updated_at=2026-10-27T09:00:00+00:00, thread_id=01a2, success)

### keywords

- Dock, autohide, defaults write com.apple.dock`;

const TITLE = "Task Group: Lore MCP test maintenance and desktop CI optimization";

/** @param {MemoryText} text */
const shown = (text) => text.parts.map((part) => ("keywords" in part ? `[${part.keywords}]` : part.markdown)).join("\n");

test("a Codex memory shows its title once and its bookkeeping as properties", () => {
  const text = new MemoryText(TITLE, CODEX).read();
  assert.equal(text.scope, "evidence-based deletion of low-signal tests while retaining product-boundary coverage");
  assert.equal(text.project, "lore-mcp", "the first group names the project");
  assert.equal(text.updated, "2026-10-27T09:00:00+00:00");
  const body = shown(text);
  assert.ok(!body.includes(TITLE), "the title is in the header, not the body");
  assert.match(body, /^## Task 1: Prune low-value tests/);
  assert.match(body, /# Task Group: macOS Dock visibility restoration/);
  assert.match(body, /`uv run pytest -q --durations=80`/);
});

test("session paths, thread ids and rollout files never reach the page", () => {
  const body = shown(new MemoryText(TITLE, CODEX).read());
  for (const hidden of ["rollout_path", "rollout_summary", ".codex/sessions", "thread_id", "applies_to", "reuse_rule", "cwd=", "/Users/someone", "updated_at", "scope:"]) {
    assert.ok(!body.includes(hidden), `${hidden} is hidden`);
  }
});

test("keywords become a quiet line where they were, and a later group keeps its scope as plain text", () => {
  const text = new MemoryText(TITLE, CODEX).read();
  assert.deepEqual(text.parts.filter((part) => "keywords" in part), [
    { keywords: "PR #559, XC-043, pytest --durations, ci-edge.test.cjs" },
    { keywords: "Dock, autohide, defaults write com.apple.dock" }
  ]);
  assert.match(shown(text), /restoration\n\npersistently restoring an auto-hidden Dock\n/);
});

test("a raw Codex note's key-value lines read the same way", () => {
  const raw = "updated_at: 2026-07-31T20:59:52+00:00\ncwd: /Users/someone/git/nano-vllm/\nrollout_path: /Users/someone/.codex/sessions/2026/07/31/rollout.jsonl\nrollout_summary_file: 2026-07-31-review.md\nkeywords: Lore, PR-38, FTS5\n\nRead the automation's memory first, then the latest stopping points.";
  const text = new MemoryText("Recent chat review", raw).read();
  assert.equal(text.project, "nano-vllm");
  assert.equal(text.updated, "2026-07-31T20:59:52+00:00");
  assert.equal(shown(text), "[Lore, PR-38, FTS5]\nRead the automation's memory first, then the latest stopping points.");
});

test("a code block inside an agent memory is left alone", () => {
  const body = "applies_to: cwd=/x/lore\n\n```\nthread_id=abc\nscope: kept\n```\n";
  assert.equal(shown(new MemoryText("Fenced", body).read()), "```\nthread_id=abc\nscope: kept\n```");
});

test("a memory that isn't in an agent's format renders exactly as before", () => {
  for (const [title, body] of [
    ["GEPA prompt tuning notes", "GEPA beat hand-tuned prompts on 3 of 4 tasks.\n\nscope: this line is the owner's own words\n\n## Setup\n\n- 40 examples"],
    ["Pricing", "# Pricing a sync placement\n\nReach first."],
    ["Pricing", "Intro line\n\n# Pricing\n\nA heading later in the body stays."],
    ["Owner notes", "### keywords\n\n- owner wrote this section"],
    ["Empty", ""]
  ]) {
    const text = new MemoryText(title, body).read();
    assert.deepEqual(text.parts, [{ markdown: body }]);
    assert.deepEqual([text.scope, text.project, text.updated], ["", "", null]);
  }
});

test("a leading heading that repeats the title drops, whatever its case and spacing", () => {
  assert.deepEqual(new MemoryText("GEPA prompt  tuning notes", "\n#  gepa Prompt tuning notes \n\nWhat mattered.").read().parts, [{ markdown: "What mattered." }]);
  assert.deepEqual(new MemoryText("Notes", "## Notes ##\nBody").read().parts, [{ markdown: "Body" }]);
});

test("a Codex chat's scratch folder isn't a project, and a later group's folder doesn't stand in for it", () => {
  for (const cwd of ["/Users/someone/Documents/Codex/2026-10-19/sav, /Users/someone/git/lore-mcp", "/Users/someone/Documents/Codex/*/give-me-a-brief and related tasks"]) {
    const body = `scope: one chat\napplies_to: cwd=${cwd}; reuse_rule=recheck\n\n# Task Group: Later\n\napplies_to: cwd=/Users/someone/git/other\n\nText.`;
    assert.equal(new MemoryText("First", body).read().project, "");
  }
  assert.equal(new MemoryText("First", "applies_to: cwd=/Users/someone/git/lore-mcp, and settings\n").read().project, "lore-mcp");
});
