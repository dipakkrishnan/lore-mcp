# Manual test walkthrough: the four user-testing scenarios

Four user-testing scenarios, written to be run by hand. The automated suites
prove the parts, not the experience: `tests/` proves the CLI and the snapshot,
`lore/node/test/` proves the Worker against a mocked facilitator,
`app/desktop/support/edge.sh` drives a handful of renderer strings. None of them
can tell you whether a person opening Lore for the first time understands what
it is, whether a sale is attributable at a glance, whether an external browser
step returns you to where you were, or whether the app's claims about your
secrets are true. That is what this document is for.

It serves two readers. A person can follow it alone, top to bottom. An agent can
also use it as a script — reading one step at a time to someone testing, and
recording what they say. `## How an agent runs this` is addressed to the agent;
everything else is addressed to the tester.

Findings get filed as backlog items or issues — never fixed inline during the
run, so the record stays a clean signal of the build's current state rather than
a moving target.

## How to run this

1. **Copy this file** to `docs/manual-test-runs/<YYYY-MM-DD>-<tester>.md`. Fill
   in that copy; leave this one blank. See `docs/manual-test-runs/README.md` for
   what is and is not safe to commit — this repository is public.
2. **Fill in the session table** under `## Before you start`.
3. **Pick your scenarios.** They are independent. Each opens with a preflight
   gate that either clears you to run or names exactly what to fix, with the
   repair procedure in Appendix A.
4. **Work the scenario's steps in order**, scoring each testable item as you go.
5. **Score the scenario's catchall row** last, against the quoted "Pass if…"
   sentence at the top of that scenario.
6. **Convert the record** when you are done:

   ```sh
   python3 support/manual_test_report.py docs/manual-test-runs/<your-file>.md
   ```

### Scoring

Every testable item takes exactly one of these:

| Result | Means |
|---|---|
| `Pass` | It did what the step said it would. |
| `Partial` | It worked, but something about it was wrong, slow, confusing, or ugly. Say what in Notes. |
| `Fail` | It did not work. Say what happened in Notes. |
| `Skipped` | You did not run it. Say why — out of tier, blocked by an earlier failure, no time. |
| `Other` | Anything the four above misrepresent. Notes are required. |

Leave the cell blank for anything you have not reached yet. A blank is not a
score; it means the item was never attempted.

**Notes are the point.** The result column tells someone how many things broke;
the notes column tells them what to do about it. `Fail` with an empty note is
close to useless. Write what you saw, in your own words.

**Reference URLs** is for links: a backlog item you filed, a GitHub issue, a
Basescan transaction, a screenshot you uploaded somewhere. Separate several with
spaces or commas.

### Filling in a row by hand

The rubric tables are ordinary markdown. Edit the cells between the pipes and
change nothing else:

```markdown
<!-- rubric:S1 name="Net-new user" -->

| TI ID | TI Name | Result | Notes | Reference URLs |
|---|---|---|---|---|
| S1-01 | Sign in with Claude or ChatGPT | Pass |  |  |
| S1-02 | Rail: Connect your agents | Partial | Found it, but I had to scroll | https://github.com/dipakkrishnan/lore-mcp/issues/188 |

<!-- /rubric -->
```

Two rules, both of which the converter enforces:

- **Do not touch the `<!-- rubric:… -->` comments, the header row, or the
  `|---|` line.** They are how the converter finds the table. They are invisible
  when the file is rendered.
- **A literal `|` inside Notes must be written `\|`**, or the row will not parse.

## How an agent runs this

Instructions for an agent facilitating a session. If you are a person reading
this document, skip to `## Before you start`.

You are running a usability session, not a test suite. The person at the
keyboard is the instrument; you are the recorder. Everything below follows from
that.

> **Agent-system controls.** In Claude Code, ask with `AskUserQuestion`. In
> Codex, ask in plain chat, one question at a time. In the Lore desktop app, use
> `ask_user`. Never block because a named question tool is unavailable — ask in
> prose instead.

**Never touch the app.** You do not click, type, navigate, or run the app's own
commands on the tester's behalf, even when they are stuck and it would be
faster. Being stuck *is the finding*. You may run the read-only verification
commands in Appendix B, because those inspect state rather than drive the app.

**One step at a time.** Read the step, say what they should look for, then stop
and wait. Never paste a whole scenario. Never read ahead to a step they have not
reached — telling them what is supposed to happen next contaminates the very
thing you are measuring.

**If you have screen-capture access, default to looking rather than asking.**
Check the screen yourself after a step that changes it, instead of asking the
tester to describe or screenshot it — that back-and-forth is exactly the
overhead this capability removes. Fall back to asking only when the capture
fails, or shows something other than the view the step expects. This still
respects "never touch the app" — reading pixels is not driving it. A
full-screen capture shows everything on the display, not just Lore; say so
once at the start of a session so the tester can judge what else is on screen,
rather than re-litigating it every time.

**Ask what happened before you ask for a verdict.** Open with "what do you see?"
or "what did you do next?" if you have no way to look yourself — never "did
that pass?". Score only once you have seen or been told what happened. If a
description and the expected behavior disagree, ask once more before
recording; do not argue anyone into a `Pass`.

**Record their words, not your summary.** Notes should read like the tester
talking. "I couldn't tell which button was the real one" is worth more than
"navigation ambiguity observed."

**Run a verification command when the step has a `Verify:` line**, report what it
returned in one sentence, and move on. Do not turn the session into a debugging
detour. If the verification contradicts what the screen showed, that is a finding
worth its own note — the screen claiming something the state does not support is
exactly what these checkpoints exist to catch.

**Never fabricate a result.** If an item was not actually observed, it is
`Skipped` with a reason. If you did not see the evidence yourself and the tester
did not describe it, you do not know it happened. This includes the catchall
rows: score them from what the tester said about the run as a whole, and if they
have not said anything about it, ask.

**Recording is a surgical edit.** In the run file you may only:

- replace the `Result`, `Notes`, and `Reference URLs` cells of a single existing
  row;
- add a row to the session table;
- replace the body of an observations block.

Never reflow a table, reorder rows, add or remove testable items, or edit a
`<!-- rubric:… -->` comment. After each edit, run:

```sh
python3 support/manual_test_report.py <run file> --check
```

If it reports an error, fix the row you just touched before continuing.

**Stop conditions.** Stop and ask the tester how they want to proceed when a
preflight gate fails, when a defect blocks the rest of the scenario, or when they
say they want to stop. Mark everything not reached as `Skipped` with the reason.
A short honest record beats a long invented one.

**Findings are filed, not fixed.** Do not edit application code during a session,
and do not offer to. When the run is over, offer to file the failures as backlog
items with the `backlog-ideate` skill, and put each item's path in that row's
Reference URLs.

## Before you start

Build the app once. Both dogfood modes launch the packaged binary, not
`electron .`:

```sh
npm --prefix app/desktop ci
npm --prefix app/desktop run package    # minutes; macOS arm64 only
```

Confirm the skills the app ships match the ones in the repository. The packaged
copy is what the tester actually exercises, and it can drift:

```sh
diff -r plugins/lore/skills \
        app/desktop/out/Lore-darwin-arm64/Lore.app/Contents/Resources/skills
```

If they differ, re-run `package` before testing, or note it — the run is
measuring a build that is not the current source.

<!-- rubric:session -->

| Field | Value |
|---|---|
| Tester |  |
| Date |  |
| App version |  |
| Git commit |  |
| Platform |  |
| Scenarios run |  |
| S4 tier |  |

<!-- /rubric -->

`Git commit` is `git rev-parse --short HEAD`. `Platform` is your macOS version
and chip. `Scenarios run` is a list like `S1, S3`. `S4 tier` is one of `none`,
`walkthrough`, `switch`, or `purchase` — see Scenario 4 — and is `none` if you
did not run S4 at all.

Anything you want to say about the run as a whole goes here, in prose:

<!-- rubric:observations -->

<!-- /rubric -->

---

## Scenario 1 — Net-new user: reach private value

> As someone opening Lore for the first time, I want to understand it and save
> something useful without needing a terminal.
>
> **Pass if** the user reaches a useful saved memory without coaching or terminal
> use and always understands the next action.

The gap this run is probing: the progressive setup rails exist, but a cohesive
first-run narrative does not. That becomes a launch blocker only if this run
leaves you asking "what is Lore?" or "what do I do now?" — so notice when you do,
and say so in S1-17.

**Do this one first if you are running several.** It is the only scenario that
wants a tester with no context, and reading the others will spoil that.

### Preflight

```sh
ls -d app/desktop/out/Lore-darwin-arm64/Lore.app   # must exist
```

| If | Then |
|---|---|
| `Lore.app` is missing | Appendix A.1 — build the app |
| You are on an Intel Mac or not on macOS | You cannot run this scenario. Mark S1 `Skipped`. |

A note on what "fresh" costs: the sandbox isolates your Lore library and the
app's own data, but keeps your real `$HOME` so the Keychain works. So a new
sandbox means a genuinely fresh sign-in *and* a full first-launch provisioning
step, which downloads a Python runtime. It is the slowest and most
failure-prone minute of this scenario. If it fails, that is S1-01, and it is a
real finding.

### Walkthrough

1. **Launch a fresh sandbox.**

   ```sh
   npm --prefix app/desktop run dogfood:new
   ```

   **Keep the output.** The fourth line it prints is the command you need in
   step 13. It looks like:

   ```
   LORE_DOGFOOD_ROOT='/var/folders/…/lore-dogfood-new.XXXXXX' npm --prefix app/desktop run dogfood:new
   ```

   Copy it somewhere now. Re-running plain `dogfood:new` later mints a *new*
   sandbox and makes the persistence check meaningless.

2. **Sign in.** The welcome screen offers `Continue with Claude`,
   `Continue with ChatGPT`, and `Use an API key instead`. Take whichever you
   have. *(S1-01)*

3. **Work the first rail: `Connect your agents`** — "Let Lore read what Claude
   Code and Codex already remember." *(S1-02)*

4. **Work the second rail: `Shape your Lore`** — "Review one proposal based on
   what your agents already know." You should land on a card headed
   `Use this shape for your Lore?`. *(S1-03)*

5. **Change something before you accept it.** The card's fields are `Name`,
   `Told as`, `Organized by`, `Topics`, `In depth`, `Lightly`, and `Voice`. Edit
   at least one, then press `Use this shape`. Score whether the change was
   actually taken, not just whether the field accepted typing. *(S1-04)*

6. **Work the third rail: `Set the rhythm`** — "Choose which model writes new
   memories, and how often." *(S1-05)*

7. **Capture a real anecdote.** Use the composer at the bottom — "What did you
   learn today?" Tell it something true and specific from your own week; a
   made-up sentence will not exercise the thing being tested. *(S1-06)*

8. **Correct what it proposes.** You should get a card headed
   `Keep this memory?` or `Keep these memories?`, with `Title` and
   `What to remember` fields you can edit. Edit one draft's wording. *(S1-07)*

9. **Drop another draft** with its `Drop` button, if more than one was proposed.
   If only one was proposed, mark S1-08 `Skipped` and say so. *(S1-08)*

10. **Save.** Press `Keep this memory` / `Keep these`. You should see
    `Saved, only on this Mac`. *(S1-09)*

11. **Open Memories and read it back.** *(S1-10)*

12. **Rename it, then edit its content**, using `Rename` and `Edit` in the memory
    sheet. *(S1-11, S1-12)*

13. **Quit Lore, then relaunch with the command you saved in step 1.** *(S1-13)*

14. **Check what survived.** You should still be signed in *(S1-14)*, the setup
    rails should still be done rather than offered again *(S1-15)*, and your
    memory should still be in Memories *(S1-16)*.

    **Verify:** the screen is not evidence. Confirm it on disk —

    ```sh
    LORE_HOME='<root>/lore' uv run lore desktop-state \
      | python3 -m json.tool | grep -A4 '"counts"'
    ```

    where `<root>` is the sandbox path from step 1.
    `library.counts.private` should be at least 1.

15. **Answer the two questions this scenario exists to ask.** At any point in the
    run, were you unsure what Lore *is*? Were you ever unsure what to do next?
    *(S1-17)* And: did you need the terminal for anything other than launching,
    or need anyone to tell you what to do? *(S1-18)*

### Rubric

<!-- rubric:S1 name="Net-new user: reach private value" -->

| TI ID | TI Name | Result | Notes | Reference URLs |
|---|---|---|---|---|
| S1-00 | Preflight gate clears |  |  |  |
| S1-01 | Sign in with Claude or ChatGPT |  |  |  |
| S1-02 | Rail: Connect your agents |  |  |  |
| S1-03 | Rail: Shape your Lore |  |  |  |
| S1-04 | Modify the proposed shape before accepting it |  |  |  |
| S1-05 | Rail: Set the rhythm |  |  |  |
| S1-06 | Capture a real anecdote |  |  |  |
| S1-07 | Edit one proposed memory |  |  |  |
| S1-08 | Drop another proposed memory |  |  |  |
| S1-09 | Save the remaining memory |  |  |  |
| S1-10 | Memories: read the saved memory |  |  |  |
| S1-11 | Memories: rename it |  |  |  |
| S1-12 | Memories: edit its content |  |  |  |
| S1-13 | Quit and relaunch with the printed sandbox command |  |  |  |
| S1-14 | Sign-in survived the relaunch |  |  |  |
| S1-15 | Setup state survived the relaunch |  |  |  |
| S1-16 | The memory survived, confirmed in the snapshot |  |  |  |
| S1-17 | Never left asking "what is Lore?" or "what now?" |  |  |  |
| S1-18 | No terminal use and no coaching was needed |  |  |  |
| S1 | Scenario 1 as a whole |  |  |  |

<!-- /rubric -->

<!-- rubric:observations:S1 -->

<!-- /rubric -->

---

## Scenario 2 — Existing user X: understand a sale

> "Something sold; show me what sold, how much, and where the payment went."
>
> **Pass if** the sale is immediately attributable and the receipt is usable
> without sight.

This scenario runs against **your real profile**, not a sandbox. Saves and
approvals during this run affect your actual library.

### Preflight

```sh
uv run lore status                      # need: a node URL, a price, publications
curl -sS -X POST <node-url> \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"preflight","version":"0"}}}'
```

| If | Then |
|---|---|
| `Node (last deploy)` is absent | Appendix A.2 — open a store on the test network |
| `serverInfo.name` reads `Lore x402 (MAINNET)` | **Stop.** Appendix A.3 — put the store back on the test network. A purchase against a mainnet node spends real money and its receipt will not be a Base Sepolia link. |
| `serverInfo.name` reads `Lore x402 (test)` | Clear to run |
| `Publication price` is `Not set` or `$0.00` | Appendix A.4 — set a price |
| No active publications | Appendix A.5 — approve and push one |
| `npx wrangler whoami` is signed out | Appendix A.6 — sign in to Cloudflare. For Sale reads sales from D1 remotely and will not refresh without it. |

### Walkthrough

1. **Launch your real profile.**

   ```sh
   npm --prefix app/desktop run dogfood:current
   ```

   Unlike the sandbox, this mode can install the real synthesis schedule. *(S2-01)*

2. **Open For Sale and read the empty state**, before buying anything. It should
   say `No sales yet. When a buyer's agent pays for a publication, it shows
   here.` Score whether it is *honest* — an empty store that implies a broken
   one, or a spinner that never resolves, is a `Fail` here even though nothing
   crashed. *(S2-02)*

   If you already have sales, note that and skip to step 3; you are then testing
   the incremental case rather than the empty one, so mark S2-02 `Skipped`.

3. **Buy something, as a separate buyer.** From the deployed node directory, not
   the repo:

   ```sh
   cd ~/.lore/node
   npm run pay -- <node-url>
   ```

   The first run generates a throwaway buyer key at `.buyer.env` — that is a
   test wallet, never your payout address. If it reports the buyer is
   underfunded, it prints faucet links; use
   `portal.cdp.coinbase.com/products/faucet`, which defaults to Base Sepolia and
   USDC. Circle's faucet defaults to the wrong chain and a wasted send locks that
   asset and network for two hours.

   **Keep the settlement receipt it prints.** You need the transaction hash in
   step 6. *(S2-03)*

4. **Leave For Sale and come back**, to force a refresh. *(S2-04)*

5. **Read the sale row.** Score the title *(S2-05)*, the date *(S2-06)*, and the
   price *(S2-07)* separately — one of them being wrong while the others are
   right is the interesting case.

6. **Read the summary line** under the section. It should carry the number of
   sales, the running total, and the date of the last one, like
   `2 sales · $0.02 · last Sep 2`. Check the arithmetic against what you have
   actually bought. *(S2-08)*

7. **Open the receipt** with the `↗` at the end of the row. *(S2-09)*

   **Verify:** the address bar host must be `sepolia.basescan.org`, and the
   transaction hash in the URL must match the settlement receipt from step 3. A
   receipt that opens the right *kind* of page for the wrong transaction looks
   identical at a glance and is a serious failure.

8. **Turn on VoiceOver** (⌘F5) and focus the `↗`. It should announce
   "See this payment on Basescan". Score what it actually said. *(S2-10)*

9. **Ask yourself the real question.** When you opened For Sale, could you tell
   what sold, for how much, and where the money went — without cross-referencing
   anything else? *(S2-11)*

### Rubric

<!-- rubric:S2 name="Understand a sale" -->

| TI ID | TI Name | Result | Notes | Reference URLs |
|---|---|---|---|---|
| S2-00 | Preflight gate clears |  |  |  |
| S2-01 | Launch the current profile |  |  |  |
| S2-02 | For Sale shows an honest empty-sales state |  |  |  |
| S2-03 | Make one test-network purchase |  |  |  |
| S2-04 | Leave and re-enter For Sale to refresh |  |  |  |
| S2-05 | Sale row shows the right title |  |  |  |
| S2-06 | Sale row shows the date |  |  |  |
| S2-07 | Sale row shows the price |  |  |  |
| S2-08 | Summary shows count, total, and last date, and they add up |  |  |  |
| S2-09 | Receipt opens Base Sepolia, and the tx matches the settlement receipt |  |  |  |
| S2-10 | VoiceOver announces "See this payment on Basescan" |  |  |  |
| S2-11 | The sale was attributable immediately |  |  |  |
| S2 | Scenario 2 as a whole |  |  |  |

<!-- /rubric -->

<!-- rubric:observations:S2 -->

<!-- /rubric -->

---

## Scenario 3 — Existing user Y: complete browser-dependent payment setup

> "Guide me through external pages; don't paste URLs or strand me during setup."
>
> **Pass if** every external action is framed, resumable, and returns control to
> the same task.

The subject here is the *handoff*, not the destination. You are testing whether
Lore hands you to a web page well and takes you back cleanly — not whether
Cloudflare's sign-up form works.

### Preflight

```sh
uv run lore status
npx --prefix ~/.lore/node wrangler whoami   # may be signed out; that's fine here
node --version                              # required by the deploy step
```

| If | Then |
|---|---|
| No publications at all | Appendix A.5 — the store task will ask you to publish first |
| `node` is missing | Install Node.js; the deploy step shells out to `npm` |
| You already have a store on the test network | You can still run S3-01 through S3-12 against a resumed or redeployed task; mark S3-13 and S3-14 by what actually happens |

**Before you reach for a fresh sandbox here, read this.** A `dogfood:new`
sandbox isolates your library and sign-in, but not the deployed
Worker/D1 identity — the Worker name in `wrangler.jsonc` is fixed, so a
sandbox deploy targets the *same* Worker and database as your real profile.
The first run of this scenario used a fresh sandbox specifically because it
looked safer, and it silently wiped the live publications catalog of a real,
in-production node as a result — see
[#257](https://github.com/dipakkrishnan/lore-mcp/issues/257), still open at
the time of writing. Until that is fixed, **prefer running this scenario
against your real profile** (`dogfood:current`) if you have one already
deployed, accepting that saves and approvals hit your real library. A fresh
sandbox is still fine for a brand-new profile with nothing live yet to lose.

### Walkthrough

1. **Start or resume `Open your store`** from Today. *(S3-01)*

2. **On the first browser card, choose `Not now`.** *(S3-02)*

3. **Check that you are not stranded.** Go back to Today. The task should be
   listed under `Unfinished`, described as ready to resume rather than failed or
   gone. *(S3-03)*

   **Verify:** quit Lore entirely and relaunch. The task should still be there
   and reopening it should replay the conversation so far, not start over.

4. **Reopen the task and look at the card properly.** Does it say what the step
   is for, in a way you could act on without asking? *(S3-04)* Does it name where
   it is sending you — the button should read `Open <domain>`? *(S3-05)*

5. **Press `Open …`.** The page should open in your real browser, and it should
   be the page the button named. *(S3-06)*

6. **Come back to Lore without finishing, and press `I got stuck`.** The card
   changes to `Finish in your browser, then come back here.` after you open the
   page, offering `I got stuck` and `Done`. Score whether the agent responds to
   *being stuck* — asking what happened, offering something different — rather
   than repeating the same instruction. *(S3-07)*

7. **Now actually do the step, and press `Done`.** *(S3-08)*

8. **Exercise the Cloudflare sign-in card.** It reads `Sign in to Cloudflare?`
   with "Your browser will open Cloudflare's sign-in page; a free account is
   enough. Come back here once it says you can close the page." and offers
   `Not now` / `Open Cloudflare`. Score whether control comes back to the task
   when you return. *(S3-09)*

9. **Exercise one more external step** — the wallet, a faucet, or Basescan.
   *(S3-10)*

10. **Scroll back through the whole thread.** Was there ever a raw URL sitting in
    prose for you to select and copy, rather than a card with a button? *(S3-11)*

11. **Check the guard rail.** Ask the agent to open a page it should refuse, for
    example `https://example.com`. It should decline with a message naming the
    only categories it will open. It should not render a card at all. *(S3-12)*

12. **Finish the deployment on the test network.** *(S3-13)*

13. **Push**, using the button in the app. The agent should not run this for you.
    *(S3-14)*

### Rubric

<!-- rubric:S3 name="Complete browser-dependent payment setup" -->

| TI ID | TI Name | Result | Notes | Reference URLs |
|---|---|---|---|---|
| S3-00 | Preflight gate clears |  |  |  |
| S3-01 | Start or resume "Open your store" |  |  |  |
| S3-02 | First browser card: choose "Not now" |  |  |  |
| S3-03 | The task stays resumable, and survives a quit |  |  |  |
| S3-04 | On retry, the card explains the step |  |  |  |
| S3-05 | The card names the destination domain |  |  |  |
| S3-06 | "Open …" opens the correct page |  |  |  |
| S3-07 | "I got stuck" gets a response to that state, not a repeat |  |  |  |
| S3-08 | Finish the step and choose "Done" |  |  |  |
| S3-09 | Cloudflare sign-in returns control to the task |  |  |  |
| S3-10 | One wallet, faucet, or Basescan step behaves |  |  |  |
| S3-11 | No raw URL was left to copy out of prose |  |  |  |
| S3-12 | An off-allowlist page is refused, with no card shown |  |  |  |
| S3-13 | The test-network deployment completes |  |  |  |
| S3-14 | Push |  |  |  |
| S3 | Scenario 3 as a whole |  |  |  |

<!-- /rubric -->

<!-- rubric:observations:S3 -->

<!-- /rubric -->

---

## Scenario 4 — Existing user Z: switch to real payments and back

> "Take my proven store to real money without asking me to use a terminal for
> secrets."
>
> **Pass if** the switch is safe, honest about what it does with your secrets,
> and reversible.

This is written as a **round trip**, in whichever direction your store starts.
If it is on the test network you will see `Switch to real payments`; if it is
already on real money you will see `Switch to play money`. Either is a valid
run — record which direction you went in the notes for S4-01.

### Declare your tier first

Write it in the session table before you begin. Items above your declared tier
must be `Skipped`; the converter rejects a run that scores them anyway.

| Tier | You will | Costs |
|---|---|---|
| `walkthrough` | Exercise the cards, the decline, the masked fields, and the secret copy. Stop before any deployment. | Nothing. No network change. |
| `switch` | All of the above, then complete the switch and switch back. | Real Coinbase API keys and two real deployments. Nobody spends anything. |
| `purchase` | All of the above, plus one real $0.01 purchase. | Real money, from a real wallet, to your payout address. |

### Preflight

The skill enforces three gates before it will switch to real money, and you
should confirm them yourself rather than trusting the flow to stop you:

```sh
uv run lore publication list          # need at least one active publication
uv run lore status                    # need a node URL
```

| If | Then |
|---|---|
| No active, pushed publication | Appendix A.5. Switching a store with nothing for sale proves nothing. |
| No settled test payment yet | Run Scenario 2 first. The gate exists because real money should follow a proven rail, not precede one. |
| The node is not answering `discover` | Neither switch button renders at all. Appendix A.2. |
| You have not decided you actually want this | Stop. This is the one step that should never be inferred. |
| Tier is `switch` or `purchase` and you have no Coinbase Developer Platform keys | Appendix A.7 — mint CDP keys. Read it first; there are three traps in that flow. |

### Walkthrough

1. **Open Settings and find the Payments row.** On the test network it reads
   "Buyers on the test network pay with play money. Switch when you want real
   buyers paying real money." On real money it reads "Buyers pay real money.
   Switch back to the test network any time; nothing already paid changes."
   Note which one you got. *(S4-01)*

2. **Press the switch button.** *(S4-01)*

3. **Reach the Coinbase Developer Platform step.** It should arrive as an
   attended card that opens the page for you, not a URL in prose. *(S4-02)*

4. **On the first secret prompt, press `Not now`.** *(S4-03)*

   **Verify:** nothing was stored. From `~/.lore/node`:

   ```sh
   npx wrangler secret list
   ```

   No `CDP_API_KEY_ID` or `CDP_API_KEY_SECRET` should have appeared. Also confirm
   nothing was written locally:

   ```sh
   grep -ril "cdp_api_key" ~/.lore 2>/dev/null    # expect no output
   ```

   *(S4-04)*

5. **Ask to try again.** The flow should offer the prompt again rather than
   dead-ending. *(S4-05)*

6. **Enter the API key ID**, on its own prompt. *(S4-06)*

7. **Enter the API key secret**, on a separate prompt. *(S4-07)*

8. **Check the fields were masked** as you typed. *(S4-08)*

9. **Scroll the conversation.** Neither value should appear anywhere in the
   transcript. *(S4-09)*

10. **Read the prompt's claim and judge whether it is accurate.** It says: "Paste
    the API key ID from Coinbase. The agent never sees it. Lore passes it to
    Cloudflare's vault and does not save it on this Mac."

    That claim is true of Lore's own code — the value goes from the input, over
    IPC, into the CLI's standard input, and out to `wrangler secret put`, and is
    never written to your library, the credential store, or a log. Two honest
    caveats: it does pass through memory and sits briefly in the input field, and
    what `wrangler` itself does is outside this project. Score whether the
    sentence is something you would defend to a careful user. *(S4-10)*

**Stop here if your tier is `walkthrough`.** Mark S4-11 through S4-15 `Skipped`,
noting the tier, and score the catchall.

11. **Let the deployment finish.** *(S4-11)*

12. **Read Settings.** It should now describe the network you switched to, in
    words — `Base` or `Base Sepolia, test network`. Raw chain identifiers are
    never shown in the UI, so do not expect one. *(S4-12)*

    Settings caches the node's state for about a minute. If it still shows the
    old network, wait and reopen before recording a failure.

13. **Verify the node itself agrees**, rather than trusting the label:

    ```sh
    curl -sS -X POST <node-url> \
      -H 'Content-Type: application/json' \
      -H 'Accept: application/json, text/event-stream' \
      -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}'
    ```

    `serverInfo.name` should read `Lore x402 (MAINNET)` after switching to real
    money, or `Lore x402 (test)` after switching back. *(S4-13)*

14. **Switch back the other way**, and confirm it returns to where it started.
    *(S4-14)*

**Stop here unless your tier is `purchase`.** Mark S4-15 `Skipped`.

15. **Make one real $0.01 purchase from a separate buyer**, and confirm the sale
    appears with a receipt that resolves on `basescan.org` rather than the
    Sepolia explorer. *(S4-15)*

### Rubric

<!-- rubric:S4 name="Switch to real payments and back" tier="walkthrough" -->

| TI ID | TI Name | Result | Notes | Reference URLs |
|---|---|---|---|---|
| S4-00 | Preflight gates clear, and the switch was genuinely intended |  |  |  |
| S4-01 | Settings offers the switch, with copy matching the current network |  |  |  |
| S4-02 | Coinbase Developer Platform opens through an attended card |  |  |  |
| S4-03 | First secret prompt: "Not now" |  |  |  |
| S4-04 | Nothing was stored, confirmed in the vault and on disk |  |  |  |
| S4-05 | Retry works after declining |  |  |  |
| S4-06 | API key ID entered on its own prompt |  |  |  |
| S4-07 | API key secret entered on its own prompt |  |  |  |
| S4-08 | Both fields were masked |  |  |  |
| S4-09 | Neither value appears in the transcript |  |  |  |
| S4-10 | The secret-handling claim is accurate |  |  |  |

<!-- /rubric -->

<!-- rubric:S4 tier="switch" -->

| TI ID | TI Name | Result | Notes | Reference URLs |
|---|---|---|---|---|
| S4-11 | The deployment completes |  |  |  |
| S4-12 | Settings reports the new network in words |  |  |  |
| S4-13 | The node itself reports the matching network |  |  |  |
| S4-14 | The reverse switch returns it to where it started |  |  |  |

<!-- /rubric -->

<!-- rubric:S4 tier="purchase" -->

| TI ID | TI Name | Result | Notes | Reference URLs |
|---|---|---|---|---|
| S4-15 | A real $0.01 purchase settles and links to mainnet Basescan |  |  |  |

<!-- /rubric -->

<!-- rubric:S4 -->

| TI ID | TI Name | Result | Notes | Reference URLs |
|---|---|---|---|---|
| S4 | Scenario 4 as a whole |  |  |  |

<!-- /rubric -->

<!-- rubric:observations:S4 -->

<!-- /rubric -->

---

## What a finding looks like

File it against the thing that broke — a component, a skill, a screen — not
against this document. A finding names:

- **Which testable item surfaced it**, by id, and which scenario run.
- **What you expected**, quoting the step.
- **What actually happened**, in your own words.
- **What state you inspected**, if a `Verify:` step was involved, and what it
  held. A screen and a snapshot disagreeing is a different bug from a screen
  simply being wrong, and only the inspection distinguishes them.

Then put the item's path or issue URL in that row's Reference URLs, so the record
points at the follow-up rather than restating it.

## Appendix A — Setup recovery

**A.1 Build the app.**

```sh
npm --prefix app/desktop ci
npm --prefix app/desktop run package
```

**A.2 Open a store on the test network.** Start `Open your store` from Today and
follow it. That is Scenario 3, so if you are here from S2's preflight, consider
running S3 first and getting both. **Read Scenario 3's preflight note before
picking a fresh sandbox for this** — until
[#257](https://github.com/dipakkrishnan/lore-mcp/issues/257) is fixed, a
sandbox deploy can silently overwrite a real profile's live store on the same
machine.

**A.3 Put the store back on the test network.** In Settings, use
`Switch to play money`, then confirm with the `initialize` call in Appendix B
that the node reports `Lore x402 (test)`. Allow a minute for Settings to catch
up.

**A.4 Set a price.** `Set a price` on Today, or the price row on For Sale.
`$0.01` is the usual test value. A price of zero needs no node at all, so the
deploy will refuse it.

**A.5 Approve and push a publication.** Draft one from a memory
(`Draft for sale` in the memory sheet), approve it under `Approve what to sell`
on Today, then press `Push to your store`. Approved is not the same as live —
buyers only see it after a push.

**A.6 Sign in to Cloudflare.**

```sh
npx --prefix ~/.lore/node wrangler login
```

**A.7 Mint Coinbase Developer Platform keys.** Three traps, in order: the portal
has an "API key wallets" page that is *not* what you want — choose **Secret API
key**; **opt out of IP allowlisting**, because a Worker has no stable outbound
address; and the secret is shown exactly once. Leave the trade, transfer, and
receive scopes unchecked. Secrets are scoped to the Worker's name, so if you plan
to rename the Worker, do it first.

## Appendix B — Verification commands

All read-only. Safe to run mid-session.

```sh
# Everything the app displays, as JSON.
uv run lore desktop-state | python3 -m json.tool

# The same, against a dogfood sandbox rather than your real library.
LORE_HOME='<sandbox>/lore' uv run lore desktop-state

# Library, price, publications, and the deployed node URL.
uv run lore status

# What network the node actually reports, independent of the UI.
curl -sS -X POST <node-url> \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"0"}}}'

# Which secrets the node holds. Never prints their values.
npx --prefix ~/.lore/node wrangler secret list

# Whether Cloudflare is signed in on this machine.
npx --prefix ~/.lore/node wrangler whoami

# Whether the packaged skills match the repository.
diff -r plugins/lore/skills \
        app/desktop/out/Lore-darwin-arm64/Lore.app/Contents/Resources/skills
```

Sanity-check the renderer before a manual pass, so you do not spend a session
rediscovering a broken build:

```sh
npm --prefix app/desktop run test:edge
```

## What this walkthrough does not decide

Whether any of this can be honestly automated. `docs/test-plan-handoff.md` holds
the open questions — how to grade agent-authored conversation, how deep to go on
accessibility, and how to stand in for Cloudflare and Coinbase below the manual
layer. None of them block running this by hand, and "this should stay a manual
walkthrough" is an acceptable outcome of running it rather than a blocker to
starting.

It also does not score the destinations. Cloudflare's sign-up form and Coinbase's
key minting are somebody else's product; note when they get in your way, but a
confusing page on `coinbase.com` is not a Lore defect.
