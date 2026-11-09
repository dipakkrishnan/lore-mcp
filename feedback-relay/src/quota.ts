/**
 * The relay's aggregate issue-creation cap, in one place that actually counts
 * every request.
 *
 * A Cloudflare Rate Limiting binding cannot do this job: its counters are
 * maintained per Cloudflare location, so a constant key still yields one
 * bucket per location and a caller spread across locations gets as many
 * buckets as it has locations. That is fine for blunting a single client's
 * burst and useless as a bound on how many issues the relay's GitHub token
 * can be made to create. A Durable Object is the shared authoritative state
 * that gives a real bound, and `lore/node/` already pays this cost once
 * (`LorePaidMCP`, with a `new_sqlite_classes` migration), so it is a pattern
 * this repo keeps rather than a new one.
 *
 * Two fixed windows, both sitting under GitHub's documented secondary limits
 * for content-creating requests (~80/minute, 500/hour) — exhausting those is
 * the thing being prevented, since it would take the relay down for everyone
 * and is the token's quota to burn.
 */
import { DurableObject } from "cloudflare:workers";
import { claim } from "./quota-window.js";

export { WINDOWS } from "./quota-window.js";

/** The one instance every request goes through. */
export const QUOTA_NAME = "global";

interface WindowRow {
  [column: string]: SqlStorageValue;
  started: number;
  used: number;
}

export class FeedbackQuota extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // SQLite-backed storage, so `exec` is synchronous and `take()` needs no
    // blockConcurrencyWhile: a Durable Object runs one request at a time and
    // there is no await between reading a window and writing it back.
    this.ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS windows (span TEXT PRIMARY KEY, started INTEGER NOT NULL, used INTEGER NOT NULL)"
    );
  }

  /** Claim one issue against every window, or refuse and claim nothing (the maths is `claim`). */
  take(): boolean {
    const next = claim(Date.now(), (span) =>
      this.ctx.storage.sql.exec<WindowRow>("SELECT started, used FROM windows WHERE span = ?", span).toArray()[0]
    );
    if (!next) return false;
    for (const { span, started, used } of next) {
      this.ctx.storage.sql.exec(
        "INSERT INTO windows (span, started, used) VALUES (?, ?, ?) " +
          "ON CONFLICT(span) DO UPDATE SET started = excluded.started, used = excluded.used",
        span,
        started,
        used
      );
    }
    return true;
  }
}
