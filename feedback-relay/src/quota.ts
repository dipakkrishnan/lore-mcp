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

/** The one instance every request goes through. */
export const QUOTA_NAME = "global";

export const WINDOWS = [
  { span: "minute", size: 60_000, limit: 60 },
  { span: "hour", size: 3_600_000, limit: 300 }
] as const;

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

  /** Claim one issue against every window, or refuse and claim nothing. */
  take(): boolean {
    const now = Date.now();
    const state = WINDOWS.map((window) => {
      const row = this.ctx.storage.sql
        .exec<WindowRow>("SELECT started, used FROM windows WHERE span = ?", window.span)
        .toArray()[0];
      const expired = row === undefined || now - row.started >= window.size;
      return {
        window,
        started: expired ? now : row.started,
        used: expired ? 0 : row.used
      };
    });
    // Check every window before touching any of them, so a refused request
    // does not deepen the hole it was refused for.
    if (state.some(({ window, used }) => used >= window.limit)) return false;
    for (const { window, started, used } of state) {
      this.ctx.storage.sql.exec(
        "INSERT INTO windows (span, started, used) VALUES (?, ?, ?) " +
          "ON CONFLICT(span) DO UPDATE SET started = excluded.started, used = excluded.used",
        window.span,
        started,
        used + 1
      );
    }
    return true;
  }
}
