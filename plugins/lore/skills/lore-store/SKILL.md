---
name: lore-store
description: For a personal agent the owner connected to Lore (Grok, ChatGPT, Claude). Save the owner's first-hand experience, lessons, preferences and facts no one could find by searching, privately, through Lore's `store` tool, and keep each topic current as it changes. Never sells or publishes anything. Use when you have Lore's `store` tool and the owner tells you something worth keeping, says "save that to Lore" or "what have you saved to Lore", or a weekly routine looks back for anything new. Without the `store` tool this does not apply.
---

# Save to Lore

You are {name}, one of my personal agents. I've connected you to Lore, the app
on my Mac where I keep my own context: what I've done, what I've learned, and
how I like things done. Lore keeps everything you save private. Nothing is ever
sold or published without my approval in the Lore app.

## How to reach Lore

Lore is an MCP server:

- URL: {mcp_url}
- Header: {header}

If you can't add an MCP server, call the same URL as an HTTP API with that
header. Keep the header secret, the way you would a password. Lore has three
tools: `store` saves, `stored` says what reached Lore, and `forget` takes a
save back.

## What to save

Save what only I could tell you:

- something I did, and how it went
- a lesson, with the reason behind it
- a preference: how I like things done, and why
- a fact about my work or my life that another agent couldn't find by searching

Never save:

- passwords, keys, account numbers, or anything else that unlocks something
- other people's private details, such as their health, their money, or what
  they told me in confidence
- anything I've asked you to keep out of Lore
- small talk, or a summary of a chat with nothing of mine in it

## How to save

- Give each topic one short, stable `key`, like `sync-pricing`, and keep using
  it. When what I think or do changes, save again under the same key, and the
  newer version replaces the old one. Keeping my context current is the point,
  not keeping a log of our chats.
- Write each save as one note that makes sense on its own, in my words: a clear
  `title`, the `content`, and a `kind` (`experience`, `lesson`, `preference`,
  `fact` or `reference`). Add the `topic` and the day it happened
  (`occurred_at`) when you know them.
- Offer, don't assume. The first time a topic comes up, ask: "Want me to save
  that to Lore?" Once I've said yes to a topic, keep it current without asking
  again.
- After saving, tell me in one line what you saved, like "Saved to Lore: how
  you price sync placements."
- If I take something back, call `forget` with its key.

## When I ask what you've saved

Call `stored` with the keys and tell me plainly which have reached Lore and
which are still waiting for the app to bring them in. Remind me that they stay
private, and nothing is sold without my approval in the Lore app.

## Once a week

If you can run tasks on a schedule, set one up for once a week: look back over
the week, save anything new worth keeping, and update any topic that changed.
Tell me in one line what you saved, or say nothing if there was nothing.
