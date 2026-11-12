---
id: AUT-004
title: The weekly synthesis day is silently Monday, whatever the owner was told
priority: P1
effort: S
component: automation-synthesis
status: in-review
related: [AUT-001, AUT-002, APP-030]
blockers: []
dependencies: []
github_issue: null
created: 2026-08-24
updated: 2026-11-12
---

## Problem

The profile schedule captures cadence and hour but no weekday;
`_rrule()` hardcodes `FREQ=WEEKLY;BYDAY=MO`. During desktop onboarding
(2026-08-23) Dipak chose "Codex weekly Sunday at 9 PM" and the model
confirmed "Sundays at 9 PM" twice — but the installed automation said
Monday, so the promised first run silently never happened. AUT-001's
notes already flag the missing knob; onboarding now makes promises
against it.

## Proposed approach

Add `weekday` to the profile schema (optional; default = the install
day, not a hardcoded Monday), thread it through `lore profile`
validation, `_rrule()`, and the launchd/Codex writers, and include the
day in the scheduling question's options so the model can only promise
what the profile can express. Backfill: regenerating from an existing
profile without a weekday keeps current behavior.

## Acceptance criteria

- [ ] The profile stores an explicit weekday for weekly cadence; `lore
      profile` validates it.
- [ ] `_rrule()` and the launchd path derive the day from the profile;
      no hardcoded Monday.
- [ ] The onboarding scheduling exchange offers the day, and the
      confirmation echoes exactly what was installed.
- [ ] Tests cover a weekly Sunday profile end to end.

## Notes

Dipak's installed automation was hand-corrected to `BYDAY=SU` on
2026-08-24 (backup kept beside it) so the first run lands Sunday as he
chose; the schema fix makes that unnecessary for the next owner.

**Prioritization pass 2026-08-26:** No blockers, small effort, concrete AC with a named user complaint behind it. Promoted `in-review` → `ready`.

**Delivery loop plan review (2026-11-12):** Moved back from `ready` to
`in-review`. Three implementation plans were written and each was
rejected by a plan reviewer that checked it against the code; the open
issues did not shrink between rounds, which suggests the item is
under-scoped as written. The reviewer's last open issues are below.
Labels such as "Test 2" or "R3" refer to that rejected plan, which
was not kept; the facts about the code stand on their own.

- AC1 gap: an explicit null day still ends up as a silent Monday. The plan
  fills the install day only when the 'day' key is missing. A weekly profile
  sent as {"cadence": "weekly", "day": null} passes AutomationProfile,
  because day is `int | None`. save_profile then drops it
  (exclude_none=True), and install() treats the missing day as the
  backfilled Monday, with _set_weekday skipped for day 0. That is the bug
  the item describes. Fix: treat `day is None` like a missing day in
  cli.profile, or reject it there, and add None to test 9's subTests or to
  test 4.
- AC3 gap: the terminal-host onboarding checkpoint can't hold the day. In
  plugins/lore/skills/lore-onboard/SKILL.md (around lines 85-97) the
  checkpoint JSON lists cadence and hour with no 'day', and says 'Keep every
  field below ... nothing else.' The plan has terminal hosts ask the day and
  'write the checkpoint after each answer', so a resumed onboarding loses
  the owner's chosen weekday. cli.profile then fills in the install day
  without saying so, which is a different day from the one the owner was
  told. Add "day" to the checkpoint example, and have test_skill_contract
  assert it.
- Wrong assumption (R3/R4): take_over must not fail when it reads the Codex
  TOML. R4 says _codex_byday raises OSError for 'anything else', and the
  plan's text applies the 'must contain BYDAY=MO' check to _codex_byday as
  well. That conflicts with the existing test that expects a BYDAY=SU TOML
  to read back as 6 (test_automation.py:478-498). take_over also runs on
  every app launch for `automation` and `desktop-state` (cli.py:735-740).
  Today codex_day swallows OSError and returns 0, so a missing file or one
  Codex rewrote never breaks the launch. Spell out that _codex_byday accepts
  any MO..SU and returns None for a missing, unmatched or malformed file,
  and that only _set_weekday raises. Add a take_over test with a malformed
  or missing TOML that falls back to the profile day without raising.
- Test 2 as written would fail in CI or touch the developer's machine. The
  real windup install (_install_claude in windup/tasks.py) raises 'Claude
  local scheduling currently requires macOS' unless the platform is darwin.
  CI runs on ubuntu-latest (.github/workflows/tests.yml). It also needs
  `claude` on PATH, and it writes the plist to
  Path.home()/Library/LaunchAgents/dev.windup.<id>.plist. LoreTestCase does
  not redirect HOME, so on a developer Mac this overwrites the real job's
  plist, the same harm N1 guards against. The plan says 'install_task writes
  a real plist into tmp' but not how. State that
  lore.automation.install_task is patched with a fake that writes a windup-
  shaped plist (Weekday 1) under tmp and returns that path, or that
  Path.home, shutil.which and sys.platform are all patched. Also patch the
  subprocess calls that _set_weekday makes.
