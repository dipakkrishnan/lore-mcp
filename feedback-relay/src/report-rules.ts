/**
 * The checks the relay's two POST endpoints make before anything is filed or forwarded, as plain
 * functions of what the request said (XC-102). index.ts reads the request and turns a refusal into
 * a response; nothing here touches a binding, so test/unit/report-rules.test.ts runs it in plain node.
 */
import { type Batch, parseBatch } from "./events.js";
import { LIMITS, ReportError } from "./report.js";

/** Why a request is turned away: the status, the `error` the body carries, and any headers. */
export type Refusal = { status: number; error: string; headers?: Record<string, string> };

/** Both endpoints take only POST. */
export function refuseMethod(method: string): Refusal | null {
  return method === "POST" ? null : { status: 405, error: "method not allowed", headers: { Allow: "POST" } };
}

/** Any of the rate-limiting layers said no. */
export const RATE_LIMITED: Refusal = { status: 429, error: "too many requests", headers: { "Retry-After": "60" } };

/** A report is JSON, by its declared Content-Type, matched case-insensitively and with any parameters. */
export function refuseContentType(contentType: string | null): Refusal | null {
  return (contentType ?? "").toLowerCase().includes("application/json")
    ? null
    : { status: 415, error: "Content-Type must be application/json" };
}

const TOO_LARGE: Refusal = { status: 413, error: "request body too large" };

/**
 * The cheap first half of the body cap: a Content-Length over the limit is refused before the body
 * is read. A missing header, or one that isn't a number (XC-066: `Number("abc")` is NaN), passes:
 * the second half (`readCapped`) holds the bytes actually read to the cap.
 */
export function refuseDeclaredLength(header: string | null, limit: number = LIMITS.bodyBytes): Refusal | null {
  return Number(header ?? "0") > limit ? TOO_LARGE : null;
}

/**
 * The body as text, read a chunk at a time and given up as soon as it passes `limit` bytes, so a
 * chunked or lying request is held to the cap without buffering more than one chunk past it (XC-066).
 */
export async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  limit: number = LIMITS.bodyBytes
): Promise<{ raw: string } | Refusal> {
  if (!body) return { raw: "" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return TOO_LARGE;
    }
    chunks.push(value);
  }
  const whole = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    whole.set(chunk, at);
    at += chunk.byteLength;
  }
  return { raw: new TextDecoder().decode(whole) };
}

/** The real body cap, in UTF-8 bytes of what was read, so a chunked or lying request is still held to it. */
export function refuseBody(raw: string, limit: number = LIMITS.bodyBytes): Refusal | null {
  return new TextEncoder().encode(raw).length > limit ? TOO_LARGE : null;
}

/** The body as JSON, or a 400 when it is not JSON at all. */
export function parseJson(raw: string): { value: unknown } | Refusal {
  try {
    return { value: JSON.parse(raw) as unknown };
  } catch {
    return { status: 400, error: "the request body is not valid JSON" };
  }
}

/** A report that could not be filed: its own status when it was refused as a report, else a 502. */
export function failure(error: unknown): Refusal {
  return error instanceof ReportError
    ? { status: error.status, error: error.message }
    : { status: 502, error: "could not file the issue" };
}

/** A usage batch is at most this many bytes. */
export const EVENTS_BODY_BYTES = 8_192;

/** A /events body as the batch the relay will forward, or why it is refused. */
export function readEvents(raw: string): { batch: Batch } | Refusal {
  const tooLarge = refuseBody(raw, EVENTS_BODY_BYTES);
  if (tooLarge) return tooLarge;
  const parsed = parseJson(raw);
  if ("status" in parsed) return parsed;
  const batch = parseBatch(parsed.value);
  return batch ? { batch } : { status: 400, error: "not a usage batch" };
}
