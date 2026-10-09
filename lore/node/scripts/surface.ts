// What a Lore node shows an agent before any payment, stated once for the two
// checks that hold a node to it: scripts/smoke.ts against a running or
// deployed node, and test/request-path.test.ts in workerd on every CI run.
//
// The canonical tool contract is contracts/mcp_tools.json. smoke.ts cannot
// read it — it also runs from the copy `lore node deploy` materializes, which
// has no contracts/ directory — so the names are repeated here on purpose and
// test/request-path.test.ts fails when they drift from that file.
//
// Keep this free of imports: it is bundled into the workerd test run.

/** The tools a node lists, sorted. */
export const TOOL_NAMES = ["answer", "discover", "get", "result"] as const;

/** Keys every discover() catalog entry carries. */
export const ENTRY_KEYS = ["id", "kind", "teaser", "updated_at"] as const;

/** Keys an entry carries only when the owner wrote them; free like the teaser. */
export const ENTRY_EXTRAS = ["not_useful_if", "sample", "useful_if"] as const;

/** Why a catalog entry's keys are wrong, or null when they are right. */
export function entryKeysProblem(keys: string[]): string | null {
  const missing = ENTRY_KEYS.filter((key) => !keys.includes(key));
  if (missing.length) return `missing ${missing.join(", ")}`;
  const allowed: readonly string[] = [...ENTRY_KEYS, ...ENTRY_EXTRAS];
  const unexpected = keys.filter((key) => !allowed.includes(key));
  return unexpected.length ? `unexpected ${unexpected.join(", ")}` : null;
}
