// APP-062: a task waiting on the owner goes back to working once the owner's step is over, run as a whole turn of the
// scripted agent. XC-097: split from test/unit/owner.test.cjs; a turn spawns through the sandbox, so this is a component test.
const assert = require("node:assert/strict");
const { rm } = require("node:fs/promises");
const { test } = require("node:test");
// Each test process gets its own scratch store, keys and CLI runtime; required before anything loads ../../src/state.cjs.
require("../../support/scratch.cjs");
const { scriptedAgent } = require("../../support/scripted.cjs");

const PAGE = { title: "Fund your wallet", url: "https://www.coinbase.com/buy", note: "Buy a little USDC." };

/** The states a turn's task went through, from the records the agent emitted. @param {AgentEvent[]} events */
const states = (events) => events.flatMap((event) => (event.type === "task" ? [[event.task.state, event.task.phase ?? null]] : []));

for (const [name, openUrl] of /** @type {Array<[string, LoreAgentOptions["openUrl"]]>} */ ([
  ["throws", async () => { throw new Error("the window went away"); }],
  ["is declined", async () => "The owner chose not to open it right now."]
])) {
  test(`a task waiting on the owner goes back to working when the step ${name}`, async () => {
    const { fauxAssistantMessage, fauxToolCall } = await import("@earendil-works/pi-ai");
    const { agent, faux, events, loreHome } = await scriptedAgent({ openUrl });
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("open_url", PAGE), { stopReason: "toolUse" }),
      fauxAssistantMessage("Done.")
    ]);
    try {
      await agent.prompt("Help me fund my wallet", "publish");
      const seen = states(events);
      const waiting = seen.findIndex(([state, phase]) => state === "needs_you" && phase === PAGE.title);
      assert.ok(waiting > 0, `needs_you while the owner acts: ${JSON.stringify(seen)}`);
      assert.equal(seen[waiting + 1]?.[0], "working", `working again once the step is over: ${JSON.stringify(seen)}`);
      assert.notEqual(seen.at(-1)?.[0], "needs_you");
    } finally {
      agent.dispose();
      await rm(loreHome, { recursive: true, force: true });
    }
  });
}
