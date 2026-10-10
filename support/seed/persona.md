# Persona: Priya Lindqvist / Tidewell (fictional)

Every name, place, number and address below is invented. Nothing here is real.

## Persona

- **Priya Lindqvist**, 34, solo founder of **Tidewell** — a booking-and-routing web app for *mobile pet groomers* (vans that drive to the customer). Based in **Port Alder, Oregon** (not a real town).
- Timeline: idea 2026-01; first paying groomer **2026-03-12**; 41 paying groomers by 2026-09; price **$29/mo**, raised to **$39/mo on 2026-08-01** with grandfathering.
- Stack (only for flavour): Django, Twilio SMS, Stripe Connect Express, hosted on Fly.
- Cast: **Delia Farrow**, owner of *Suds & Buds Mobile Grooming*, first customer. **Marcus Abernathy-Ruiz**, contract developer. **Cedar Hollow Veterinary**, referral partner (contact **Dr. Imani Okafor-Reyes**).
- Contact details that are deliberately fake and **allow-listed for the scrubber**: email `priya@tidewell.example` (reserved TLD), phone `+1 (555) 013-4477` (555-01xx is reserved for fiction), API key `tw_live_sk_4f3c9a1e7b2d4e5f6a7b8c9d0e1f2a3b` (invented prefix; must never be a real format like `sk_live_`).
- Public account display name everywhere: **"Priya @ Tidewell"**; bio: "Building Tidewell, bookings and routes for mobile groomers. Seed account for the Lore connector test suite (github.com/… lore-mcp). Nothing here is real."

## The eight lessons the corpus carries (the synthesis targets)

| # | Lesson (use this wording, or close, so cross-source matching is testable) | Appears in |
|---|---|---|
| L1 | "A 25 % no-show deposit cut no-shows from 18 % to 4 % in six weeks." **(the cross-source duplicate)** | obsidian, chatgpt, substack, granola, notion |
| L2 | "A reminder SMS two hours before the slot beats one the night before; the night-before one gets ignored." | obsidian, bluesky |
| L3 | "Batching a groomer's day by neighbourhood saves about an hour of driving; that hour is the whole pitch." | blog, medium |
| L4 | "One-van shops churn the month they get busy; two-van shops stay because the second van needs the calendar." | claude, notion |
| L5 | "Stripe Connect Express holds the first payout about seven days; warn groomers before they sign up or they think they were robbed." | chatgpt, granola |
| L6 | "Raising $29 to $39 with grandfathering lost nobody; the new price only ever applied to people who never saw the old one." | substack, bluesky, granola |
| L7 | "Vet clinics refer groomers if you give them a printable card with the clinic's own name on it." | granola, notion |
| L8 | "Do not build calendar sync before fifty customers; the first forty never asked for it." | claude, medium, obsidian |

## Canary scheme

Every corpus item carries exactly one canary token of the form `canary-<connector>-<nn>` (for example `canary-obsidian-01`), written in the body as a plain sentence such as `Internal tag: canary-obsidian-01.` For public posts the last line is `tidewell-seed · canary-substack-02`. Dropped items also carry a canary so the assertion is symmetric: kept means `lore search canary-x-nn --json` returns exactly one memory from the expected source; dropped or excluded means it returns `[]`.

Additionally, every item in a public account contains the phrase **"tidewell-seed"** somewhere, so anything that leaks into a synthesis or a draft publication is greppable.
