import { tracing } from "cloudflare:workers";
import type { SpanAttributes } from "./telemetry.js";

export type SetAttributes = (attributes: () => SpanAttributes) => void;

/** Run the operation exactly once, even if tracing fails before or after it.
 * Attribute construction is also best-effort; rejected values are never logged.
 * Returning the original work preserves business errors instead of retrying it. */
export async function withSpan<T>(name: string, operation: (setAttributes: SetAttributes) => T | Promise<T>): Promise<T> {
  let work: Promise<T> | undefined;
  const run = (span?: Span) => work ??= Promise.resolve().then(() => operation((attributes) => {
    try {
      span?.setAttributes(attributes());
    } catch {
      // Drop invalid or unavailable telemetry without affecting the operation.
    }
  }));
  try {
    await tracing.enterSpan(name, run);
  } catch {
    // The operation's own failure is rethrown by returning work below.
  }
  return run();
}
