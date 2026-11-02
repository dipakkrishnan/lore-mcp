// Telling a buyer's agent that its bid has a new answer: one POST of the bid's public shape to
// the callback address it gave. One attempt, never on yourlore.dev, so a callback can't loop back.

const TIMEOUT_MS = 5000;

/** An https address outside yourlore.dev and its subdomains. */
export function callbackAllowed(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return url.protocol === "https:" && value.length <= 2048 && host !== "yourlore.dev" && !host.endsWith(".yourlore.dev");
  } catch {
    return false;
  }
}

/** Sends once and logs a failure; the caller runs it in waitUntil so the answer never waits. */
export async function tellBuyer(callback, bid) {
  if (!callbackAllowed(callback)) return;
  try {
    const response = await fetch(callback, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bid),
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
    await response.body?.cancel();
    if (!response.ok) console.warn(`bid ${bid.id}: callback answered ${response.status}`);
  } catch (error) {
    console.warn(`bid ${bid.id}: callback failed: ${error.message}`);
  }
}
