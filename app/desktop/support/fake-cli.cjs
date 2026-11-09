// APP-272: the `lore` CLI as a function in the test's own process, for unit tests that check only what the app sends
// the CLI (argv, stdin, environment) and what it makes of the answer. Nothing starts: no uv, no shell, no Python.
// Required before anything loads ../src/state.cjs, as support/scratch.cjs is for the component tests: state.cjs reads
// its store folder once, on require, and a decision writes a launch key, so both go to scratch, never the owner's.
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

process.env.LORE_STORE = mkdtempSync(join(tmpdir(), "lore-store-"));
const KEYS = mkdtempSync(join(tmpdir(), "lore-keys-"));
process.once("exit", () => rmSync(KEYS, { recursive: true, force: true }));
process.once("exit", () => rmSync(/** @type {string} */ (process.env.LORE_STORE), { recursive: true, force: true }));
const state = require("../src/state.cjs");
state.useKeys(join(KEYS, "attended.d"));

/** One call the stand-in took: the argv after `lore`, stdin (undefined when the app sent none) and the environment.
 * @typedef {{args: string[], input: string | undefined, env: NodeJS.ProcessEnv}} Call */
/** @typedef {{stdout?: string, stderr?: string, code?: number}} CliAnswer */

/** Until a test says how the CLI answers, a call fails the test instead of reaching a real CLI. */
const unanswered = () => {
  throw new Error("a unit test ran the CLI without saying how it answers (support/fake-cli.cjs)");
};
state.useRuntime(unanswered);

/** Stand in for the CLI from here on: `answer` says what each call prints (nothing, when it returns nothing), and
 * every call is kept, in order, on the list this hands back.
 * @param {(args: string[], call: Call) => CliAnswer | void | Promise<CliAnswer | void>} [answer] @returns {Call[]} */
function fakeCli(answer = () => undefined) {
  /** @type {Call[]} */
  const calls = [];
  state.useRuntime(async (args, { env, input }) => {
    const call = { args, input, env };
    calls.push(call);
    return (await answer(args, call)) ?? {};
  });
  return calls;
}

/** What the CLI prints for `value` with --json. @param {unknown} value @returns {CliAnswer} */
const json = (value) => ({ stdout: `${JSON.stringify(value)}\n` });

/** A refusal as the CLI says it: `lore: why` on stderr, exit 1. @param {string} why @returns {CliAnswer} */
const refused = (why) => ({ stderr: `lore: ${why}\n`, code: 1 });

module.exports = { fakeCli, json, refused, KEYS };
