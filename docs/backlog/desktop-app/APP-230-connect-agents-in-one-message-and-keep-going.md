---
id: APP-230
title: Connect ChatGPT in one message, and end the first run on the next AI and its schedule
priority: P1
effort: XS
component: desktop-app
status: in-review
related: [APP-215, APP-217, APP-229]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-19
updated: 2026-10-19
---

## Problem

The owner's first-run walk on Oct 19 turned up three problems:

- **ChatGPT's steps were wrong.** They should have been Plugins › settings › Add MCP server › Streamable HTTP › URL, no arguments. Three steps were also more than the owner needs, since ChatGPT can add the server itself when sent a message, as Grok Bot does.
- **The first run ended after one agent.** Most people talk to more than one AI.
- **Nothing asked the agent to keep saving on its own** at the moment it first worked.

## Proposed approach

- ChatGPT leads with a message to copy that adds Lore itself. The corrected steps sit folded under "Or add it by hand".
- Once connected, one message to paste does both jobs: save now, then set up the agent's scheduled task or routine. The agent asks the owner before it schedules anything, so there is no second paste.
- It ends on "Connect another AI" beside "Go to Today".

## Acceptance criteria

- [ ] ChatGPT's sheet and first-run card lead with the message, its key masked, with the steps folded.
- [ ] The connect step shows one message that saves now and sets up the evening schedule. After the first save, the first run ends on Connect another AI and Go to Today.
