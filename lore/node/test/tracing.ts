import { tracing } from "cloudflare:workers";
import { vi } from "vitest";

export interface CapturedSpan {
  name: string;
  attributes: Record<string, unknown>;
}

/**
 * Replaces `tracing.enterSpan` with a recording version that still runs the
 * wrapped callback, so the code under test executes normally while the
 * returned array fills with what it recorded. Only intercepts our own
 * `lore.*` spans — every other name (D1's internal spans included; the
 * runtime's own `withSpan` helper calls `span.setAttributes`, which a bare
 * recording stub does not implement) passes straight through to the real
 * `tracing.enterSpan`. Call once per test; restore with
 * `vi.restoreAllMocks()` in `afterEach` (every spec file that uses this
 * already does, for `mockFacilitator`).
 */
export function captureSpans(failure?: "start" | "attributes" | "end"): CapturedSpan[] {
  const spans: CapturedSpan[] = [];
  const real = tracing.enterSpan.bind(tracing);
  vi.spyOn(tracing, "enterSpan").mockImplementation(((
    name: string,
    fn: (span: {
      setAttribute: (key: string, value: unknown) => void;
      setAttributes: (attrs: Record<string, unknown>) => void;
    }) => unknown,
    ...rest: unknown[]
  ) => {
    if (!name.startsWith("lore.")) {
      return (real as (...args: unknown[]) => unknown)(name, fn, ...rest);
    }
    if (failure === "start") throw new Error("tracing unavailable");
    const attributes: Record<string, unknown> = {};
    spans.push({ name, attributes });
    const result = fn({
      setAttribute: (key, value) => {
        attributes[key] = value;
      },
      setAttributes: (attrs) => {
        if (failure === "attributes") throw new Error("tracing unavailable");
        Object.assign(attributes, attrs);
      }
    });
    if (failure === "end") return Promise.resolve(result).then(() => { throw new Error("tracing unavailable"); });
    return result;
  }) as typeof tracing.enterSpan);
  return spans;
}
