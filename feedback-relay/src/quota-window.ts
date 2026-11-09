/**
 * The window maths behind FeedbackQuota.take (XC-102), apart from the Durable Object's storage so
 * test/unit/quota-window.test.ts can run it in plain node. quota.ts reads each window's row, asks
 * `claim`, and writes back what it returns.
 */

export const WINDOWS = [
  { span: "minute", size: 60_000, limit: 60 },
  { span: "hour", size: 3_600_000, limit: 300 }
] as const;

export type Window = { span: string; size: number; limit: number };

/** A window's stored count: when it opened, and how many issues it has let through. */
export type Count = { started: number; used: number };

/**
 * Claim one issue against every window at `now`: each window's count afterwards, or null when any
 * window is already at its limit, in which case nothing is claimed. A window with no row, or whose
 * span has run out (`now - started >= size`), starts again at `now` from zero.
 */
export function claim(
  now: number,
  current: (span: string) => Count | undefined,
  windows: readonly Window[] = WINDOWS
): ({ span: string } & Count)[] | null {
  const state = windows.map((window) => {
    const row = current(window.span);
    const expired = row === undefined || now - row.started >= window.size;
    return { window, started: expired ? now : row.started, used: expired ? 0 : row.used };
  });
  // Check every window before touching any of them, so a refused request
  // does not deepen the hole it was refused for.
  if (state.some(({ window, used }) => used >= window.limit)) return null;
  return state.map(({ window, started, used }) => ({ span: window.span, started, used: used + 1 }));
}
