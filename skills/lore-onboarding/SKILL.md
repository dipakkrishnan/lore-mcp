---
name: lore-onboarding
description: Run a gamified, persona-driven interview to capture the shape of the owner's Lore — their name, persona archetype, topic outline, focus vs. general areas, organizing axis, and storytelling voice — then persist it with `lore blueprint apply`. Trigger on requests like "onboard me to Lore", "set up my lore persona", or "build my lore blueprint".
---

# Lore onboarding: the gamified persona interview

## Goal

Lore needs to know the *shape* the owner wants for their memory: what it covers, where they
want depth vs. breadth, how they want it organized, and how they like to tell their story.
Asking for that directly is a cold, tedious form. Instead, this skill asks the owner to pick
a **persona archetype** — Storyteller, elementary schoolteacher, college professor, business
executive, or wise sage — and that single choice seeds the answers to almost everything else.
The interview then just confirms or lets the owner adjust what the persona implies.

**The persona is a structural archetype, not a voice costume.** Picking "Professor" doesn't
just change how questions are phrased — it proposes that the owner's lore is organized by
domain of knowledge, goes deep where they have expertise, and stays survey-level elsewhere.
Picking "Storyteller" proposes a chronological arc instead. Say this out loud to the owner
after they pick, so they feel the choice mattering, not just decorating a question.

## Rules

1. **Never write `~/.lore/blueprint/*` (or any Lore file) directly.** The only way to persist
   what you learn is to assemble the JSON below, write it to a temp file, and run
   `lore blueprint apply <file>`. That command is the single validating write path — treat it
   the same way you'd treat a review-required API, not a plain file write.
2. **One question at a time.** Stay in the chosen persona's voice for every question after the
   opener.
3. **Map every free-text answer to the canonical enum values** in the Crosswalk section below
   before assembling the JSON. Never invent a persona or axis value outside the enums.
4. **Show the assembled map and get explicit confirmation before applying.** Render it roughly
   like `lore blueprint show` would (see the Persona → structure table for section names) and
   ask "does this look right?" before running `apply`.
5. If the owner's answer doesn't cleanly map to an enum, ask a quick clarifying follow-up
   rather than guessing.

## The interview

### Opener (same for everyone)

> "What's your name, and which of these do you most identify with — Storyteller, elementary
> schoolteacher, college professor, business executive, or wise sage?"

Map the answer to a `persona` value (see Crosswalk), then immediately tell the owner how that
choice shapes their lore, e.g. for professor:

> "Got it, Professor Ada. That means your lore will be organized by domain of knowledge, with
> deep branches where you have real expertise and lighter survey-level coverage elsewhere.
> We'll build out your course from here — and you can always steer the organization
> differently if that doesn't fit."

### Persona → structure (what each archetype implies)

| | Storyteller | Schoolteacher | Professor | Executive | Sage |
|---|---|---|---|---|---|
| Metaphor | Story in chapters | Classroom curriculum | University field of study | Executive briefing | Book of distilled wisdom |
| Default axis | chronological | theme | knowledge | project | theme |
| Depth posture | narrative (turning points, selective) | broad (fundamentals, few deep dives) | deep (rationale, evidence, nuance) | prioritized (decisions, tradeoffs) | distilled (principles, judgment) |
| Outline section | Chapters | Subjects | Course outline | Agenda | Teachings |
| Focus section | Turning points | Core lessons | Deep dives | Priorities | Deep wisdom |
| General section | Backdrop | Light touch | Survey level | Summary-only | Passing mentions |
| Voice section | How I tell it | How I teach it | How I lecture | How I brief it | How I counsel |

### Persona-flavored questions (all five reach the same goals)

| Goal | Storyteller | Schoolteacher | Professor | Executive | Sage |
|---|---|---|---|---|---|
| **Topic outline** | "What tales and chapters make up your story? Broad strokes, not every scene." | "What subjects and units will your class cover this year? A rough syllabus is fine." | "What topics would you like to cover in your course? It doesn't have to be complete." | "What key areas of the business do you want on record? High-level agenda, not line items." | "What areas of wisdom shall we inscribe? Speak in broad themes." |
| **Focus vs. general** | "Which chapters deserve rich detail, and which stay a quick summary?" | "Which units need full lesson plans, and which are fine at a high level?" | "Which topics get a deep-dive lecture, and which are survey-level?" | "Which areas need granular reporting, and which stay executive-summary?" | "Which teachings deserve careful elaboration, and which only a passing mention?" |
| **Organizing axis** (confirm-or-override the persona default) | "So — should the story unfold in the order it happened, or would you rather group it by theme, by the quests you took on, or by the lessons you learned?" | "Keep the classroom organized by subject, or would calendar order, class projects, or skills mastered fit better?" | "Keep the course structured by domain of knowledge, or would chronological, thematic, or by-research-project fit better?" | "Keep the briefing organized by project/initiative, or would timeline, theme, or domain of expertise fit better?" | "Keep your wisdom arranged by theme, or would the seasons of your life, your endeavors, or bodies of knowledge fit better?" |
| **Storytelling / voice** | "How do you like to tell your tales — long-form narrative, short anecdotes, campfire style?" | "How do you like to teach it — story time, hands-on activities, worksheets?" | "How do you prefer to deliver material — lectures, seminars, published papers?" | "How do you like to communicate — briefings, memos, board decks, elevator pitches?" | "How do you prefer to impart it — parables, proverbs, long counsel?" |

## Crosswalk (free text → canonical enum)

**Persona** (`persona` field):
- Storyteller → `storyteller`
- elementary schoolteacher → `schoolteacher`
- college professor → `professor`
- business executive → `executive`
- wise sage → `sage`

**Organizing axis** (`organizing_axis` field — only include it if the owner *overrides* the
persona default; omit it entirely if they keep the default):
- "the order it happened / calendar / timeline / quarter / seasons of your life" → `chronological`
- "by theme / by subject / by initiative" → `theme`
- "the quests you took on / class projects / research project / deal / your endeavors" → `project`
- "the lessons you learned / skills mastered / domain of knowledge / expertise" → `knowledge`

## Assemble + persist

Build exactly this shape (only the fields shown — do not add `captured_at`, `depth_default`,
or `section_labels`; the command derives those from the persona):

```json
{
  "version": 1,
  "name": "<name>",
  "persona": "<storyteller|schoolteacher|professor|executive|sage>",
  "organizing_axis": "<only if the owner overrode the persona default — omit otherwise>",
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

Show the owner the rendered `lore blueprint show` output as confirmation that their lore map
was captured. If `apply` errors (e.g. a value didn't validate), fix the offending field and
retry — don't ask the owner to debug JSON.
