---
id: APP-264
title: A phone companion for triage, check-in and capture
priority: P2
effort: L
component: desktop-app
status: ideation
related: [XC-088, XC-067, AUT-012, APP-263]
blockers: []
dependencies: []
github_issue: null
created: 2026-10-29
updated: 2026-10-29
---

## Problem

Lore's daily moments are small: an agent saved something, the evening check-in has a question, or a thought
is worth keeping. Today all of them wait for the owner to be at their Mac. Most of the owner's agents (Grok
Bot, Instinct, ChatGPT) already live on their phone, so the place they save from and the place they review
are on different devices.

## Proposed approach

A phone companion that does three things and nothing more. Linear's mobile app is the model: it is mostly triage.

- **Inbox.** The calm Today list from the desktop redesign: Keep, Delete or Draft for sale on what agents and
  apps brought in. Draft for sale only starts a draft. Approving a piece for sale stays on the Mac.
- **Check-in.** Answer the evening questions.
- **Capture.** Type or dictate a thought, which lands as a private memory.

**Where it reads from.** The library lives on the owner's Mac, and agent saves are sealed so only the Mac can
read them (XC-067). The phone would get its own key, added from the Mac the way a device is added. It reads and
writes through the same store address the agents already use (the hosted store, XC-088, or the owner's own
Cloudflare). The Mac stays the source of truth and collects what the phone did. No new server.

**Open questions:**
- Key handoff: a QR code shown on the Mac is the obvious shape. What happens when a phone is lost (revoke from the Mac)?
- What the phone can read: only the Inbox's new items and check-in questions, or the whole library? Start with the Inbox.
- Native app, or a web app served from the store? A web app ships without App Store review but needs keys kept safely in the browser.

## Acceptance criteria

- [ ] A phone, paired from the Mac, shows the Inbox and acts on it, and the Mac reflects every action.
- [ ] The phone answers the check-in and captures a memory that lands private on the Mac.
- [ ] Revoking the phone from the Mac stops it at once.
- [ ] Nothing the phone does publishes or prices anything.

## Notes

Prompted by the Oct 29 phone-playable mock of the calm redesign (artifact TufZqzUppPPhKqCpYTY2hF). It shows
the Inbox, Connectors, Automations and Settings at phone width with a bottom tab bar.
