import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { QUOTA_NAME } from "../src/quota";

/**
 * Empty the aggregate quota's windows.
 *
 * FEEDBACK_QUOTA is one shared Durable Object — that is the whole point of
 * it — so its counters survive between tests unless a test clears them.
 * Deleting the rows rather than the storage keeps the table the constructor
 * created, which is what `take()` expects to find.
 */
export async function resetQuota(): Promise<void> {
  const stub = env.FEEDBACK_QUOTA.get(env.FEEDBACK_QUOTA.idFromName(QUOTA_NAME));
  await runInDurableObject(stub, (_instance, state) => {
    state.storage.sql.exec("DELETE FROM windows");
  });
}
