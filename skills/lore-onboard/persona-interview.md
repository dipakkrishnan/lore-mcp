# Phase 1 reference: the gamified persona interview

This is Phase 1 of the `lore-onboard` skill. It is not a separately triggered skill —
`SKILL.md` sends you here. It captures the *shape* the owner wants for their lore
(topic outline, focus vs. general, organizing axis, voice) as a persona-driven
interview, and persists it with `lore blueprint apply`. Phase 2 reads what you capture
here to steer the profile draft, so do this first.

**The persona is a structural archetype, not a voice costume.** Picking "Professor"
doesn't just change phrasing — it proposes the owner's lore is organized by domain of
knowledge, goes deep where they have expertise, and stays survey-level elsewhere.
"Storyteller" proposes a chronological arc instead. Say this out loud after they pick,
so the choice feels like it matters.

## Rules

1. **Never write `~/.lore/blueprint/*` (or any Lore file) directly.** Persist only by
   assembling the JSON below, writing it to a temp file, and running
   `lore blueprint apply <file>` — the single validating write path.
2. **One question at a time**, in the chosen persona's voice after the opener.
   **Default to `AskUserQuestion` so the owner picks instead of composing** — the goal is
   for them to think less. This includes the questions phrased open-endedly below (topic
   outline, focus vs. general): read the owner's actual projects/domains from their
   history and offer *those* as selectable options rather than asking them to type a
   list. Use `multiSelect` when several answers apply, and put your best guess first.
   `AskUserQuestion` allows at most **4 options** (plus an automatic "Other"); when a
   question has more, see the opener's tool note. Drop to plain chat only when you truly
   cannot enumerate the choices — a free-form name, or a voice/storytelling answer that
   resists a fixed menu.
3. **Map every free-text answer to the canonical enum** in the Crosswalk before
   assembling JSON. Never invent a persona or axis value.
4. **Show the assembled map and get explicit confirmation before applying.**
5. If an answer doesn't cleanly map to an enum, ask a quick clarifying follow-up.

## Opener (same for everyone)

> "What's your name, and which of these do you most identify with — Storyteller,
> elementary schoolteacher, college professor, business executive, or wise sage?"

**Tool note:** this is five personas but `AskUserQuestion` caps at four options, so ask
the opener in plain chat as a numbered list — folding the fifth into "Other" would hide a
real choice. This is the *one* question that must be plain chat; every question after it
uses `AskUserQuestion` wherever the options can be enumerated (Rule 2). The name is
free-form — collect it in the same plain-chat opener.

Map to a `persona` value, then tell the owner how that choice shapes their lore, e.g.:

> "Got it, Professor Ada. Your lore will be organized by domain of knowledge, deep where
> you have real expertise and lighter survey-level coverage elsewhere. You can steer the
> organization differently if that doesn't fit."

## Persona → structure

| | Storyteller | Schoolteacher | Professor | Executive | Sage |
|---|---|---|---|---|---|
| Metaphor | Story in chapters | Classroom curriculum | University field of study | Executive briefing | Book of distilled wisdom |
| Default axis | chronological | theme | knowledge | project | theme |
| Depth posture | narrative (turning points, selective) | broad (fundamentals, few deep dives) | deep (rationale, evidence, nuance) | prioritized (decisions, tradeoffs) | distilled (principles, judgment) |
| Outline section | Chapters | Subjects | Course outline | Agenda | Teachings |
| Focus section | Turning points | Core lessons | Deep dives | Priorities | Deep wisdom |
| General section | Backdrop | Light touch | Survey level | Summary-only | Passing mentions |
| Voice section | How I tell it | How I teach it | How I lecture | How I brief it | How I counsel |

## Persona-flavored questions (all five reach the same goals)

| Goal | Storyteller | Schoolteacher | Professor | Executive | Sage |
|---|---|---|---|---|---|
| **Topic outline** | "What tales and chapters make up your story? Broad strokes, not every scene." | "What subjects and units will your class cover this year? A rough syllabus is fine." | "What topics would you like to cover in your course? It doesn't have to be complete." | "What key areas of the business do you want on record? High-level agenda, not line items." | "What areas of wisdom shall we inscribe? Speak in broad themes." |
| **Focus vs. general** | "Which chapters deserve rich detail, and which stay a quick summary?" | "Which units need full lesson plans, and which are fine at a high level?" | "Which topics get a deep-dive lecture, and which are survey-level?" | "Which areas need granular reporting, and which stay executive-summary?" | "Which teachings deserve careful elaboration, and which only a passing mention?" |
| **Organizing axis** (confirm-or-override the persona default) | "Should the story unfold in the order it happened, or grouped by theme, by the quests you took on, or by the lessons you learned?" | "Keep the classroom organized by subject, or would calendar order, class projects, or skills mastered fit better?" | "Keep the course structured by domain of knowledge, or would chronological, thematic, or by-research-project fit better?" | "Keep the briefing organized by project/initiative, or would timeline, theme, or domain of expertise fit better?" | "Keep your wisdom arranged by theme, or would the seasons of your life, your endeavors, or bodies of knowledge fit better?" |
| **Storytelling / voice** | "How do you like to tell your tales — long-form narrative, short anecdotes, campfire style?" | "How do you like to teach it — story time, hands-on activities, worksheets?" | "How do you prefer to deliver material — lectures, seminars, published papers?" | "How do you like to communicate — briefings, memos, board decks, elevator pitches?" | "How do you prefer to impart it — parables, proverbs, long counsel?" |

## Crosswalk (free text → canonical enum)

**Persona** (`persona`): Storyteller → `storyteller`; elementary schoolteacher →
`schoolteacher`; college professor → `professor`; business executive → `executive`;
wise sage → `sage`.

**Organizing axis** (`organizing_axis` — include *only* if the owner overrides the
persona default; omit to keep the default):
- "the order it happened / calendar / timeline / quarter / seasons of your life" → `chronological`
- "by theme / by subject / by initiative" → `theme`
- "the quests you took on / class projects / research project / deal / your endeavors" → `project`
- "the lessons you learned / skills mastered / domain of knowledge / expertise" → `knowledge`

## Assemble + persist

Build exactly this shape — only these fields. Do not add `captured_at`,
`depth_default`, or `section_labels`; the command derives those from the persona (and
rejects them as input).

```json
{
  "version": 1,
  "name": "<name>",
  "persona": "<storyteller|schoolteacher|professor|executive|sage>",
  "organizing_axis": "<only if the owner overrode the default — omit otherwise>",
  "topic_outline": ["<broad topic>", "..."],
  "focus_topics": ["<area they want granular>", "..."],
  "general_areas": ["<area they're fine generalizing>", "..."],
  "storytelling": "<how they want to tell/share it, in their words>"
}
```

Then:

```sh
tmpfile=$(mktemp)
cat > "$tmpfile" <<'EOF'
<the JSON above>
EOF
lore blueprint apply "$tmpfile"
lore blueprint show
```

Show the rendered `lore blueprint show` output as confirmation. If `apply` errors, fix
the offending field and retry — don't ask the owner to debug JSON. Then return to
`SKILL.md` Phase 2.
