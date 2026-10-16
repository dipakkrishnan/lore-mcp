export type Failure = { error: string; status: number };

export function fail(status: number, error: string): Failure {
  return { status, error };
}

export function failed(value: unknown): value is Failure {
  return typeof value === "object" && value !== null && "error" in value;
}

export function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

/** A Durable Object result as the owner API's response: `{error}` on a Failure, else `ok` with the body (204 when null). */
export function respond(result: unknown, ok = 200): Response {
  if (failed(result)) return json({ error: result.error }, result.status);
  return result === null ? new Response(null, { status: 204 }) : json(result, ok);
}
