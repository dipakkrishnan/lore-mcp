import contract from "../../contracts/usage_events.json";

/**
 * Anonymous usage events (APP-058). The relay is the check, not the client:
 * an event reaches PostHog only if its name and its one coded property are in
 * contracts/usage_events.json. Anything else in a batch is dropped, never
 * stored, so an old or altered copy of Lore can't widen what is collected.
 */

const EVENTS = contract.events as Record<string, { prop: string; values: string[] } | null>;
const INSTALL_ID = /^[0-9a-f]{32}$/;
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
const AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;
export const MAX_EVENTS = 20;

export type Event = { name: string; props: Record<string, string>; at: string };
export type Batch = { install_id: string; version: string; events: Event[] };

function event(value: unknown): Event | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, props, at } = value as Record<string, unknown>;
  if (typeof name !== "string" || !Object.hasOwn(EVENTS, name) || typeof at !== "string" || !AT.test(at)) return null;
  const allowed = EVENTS[name];
  const given = typeof props === "object" && props !== null ? Object.entries(props) : [];
  if (!allowed) return given.length ? null : { name, props: {}, at };
  if (given.length !== 1) return null;
  const [[key, coded]] = given;
  return key === allowed.prop && typeof coded === "string" && allowed.values.includes(coded) ? { name, props: { [key]: coded }, at } : null;
}

/** The batch with every event that isn't on the list removed; null when the envelope itself is wrong. */
export function parseBatch(value: unknown): Batch | null {
  if (typeof value !== "object" || value === null) return null;
  const { install_id, version, events } = value as Record<string, unknown>;
  if (typeof install_id !== "string" || !INSTALL_ID.test(install_id)) return null;
  if (typeof version !== "string" || !VERSION.test(version)) return null;
  if (!Array.isArray(events) || events.length > MAX_EVENTS) return null;
  return { install_id, version, events: events.map(event).filter((e): e is Event => e !== null) };
}

/** Pass the checked events to PostHog's batch endpoint; a missing key means none are kept. */
export async function forward(env: Env, batch: Batch): Promise<void> {
  if (!env.POSTHOG_KEY || !batch.events.length) return;
  await fetch(`${env.POSTHOG_HOST}/batch/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: env.POSTHOG_KEY,
      batch: batch.events.map(({ name, props, at }) => ({
        event: name,
        distinct_id: batch.install_id,
        timestamp: at,
        // No person profile, no IP-derived location: an install is an id and a version.
        properties: { ...props, app_version: batch.version, $process_person_profile: false, $ip: null }
      }))
    })
  });
}
