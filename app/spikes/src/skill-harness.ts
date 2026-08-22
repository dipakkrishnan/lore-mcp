import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { LoreKernel } from "./kernel.js";
import { FileCredentialStore } from "./store.js";
import { Terminal } from "./terminal.js";

const args = process.argv.slice(2);
const skillName = args.find((a) => !a.startsWith("--")) ?? "lore-capture";
const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
const loreHome = join(homedir(), ".lore-spike-home");
mkdirSync(loreHome, { recursive: true });

const terminal = new Terminal();
const kernel = await LoreKernel.create({
  loreHome,
  skillsDir: join(repoRoot, "plugins/lore/skills"),
  credentials: new FileCredentialStore(join(homedir(), ".lore", "spike-credentials.json")),
  owner: terminal
});
const session = await kernel.session(process.env.LORE_SPIKE_MODEL ?? "claude-sonnet-5");

console.log(`Skill: ${skillName}\nLore home: ${loreHome}\nModel: ${session.model?.id}\n`);

let sessionCost = 0;
session.subscribe((event) => {
  if (event.type === "tool_execution_start") {
    console.log(`  ⚙ ${event.toolName}`);
  } else if (event.type === "message_end" && event.message.role === "assistant") {
    const body = event.message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    if (body) console.log(`\n${body}\n`);
    sessionCost += event.message.usage.cost.total;
  }
});

console.log("Type to talk to the agent; 'quit' exits.\n");
let input = kernel.invocation(skillName);
try {
  for (;;) {
    await session.prompt(input);
    const line = (await terminal.read("you> ")).trim();
    if (line === "quit" || line === "exit") break;
    input = line;
  }
} finally {
  session.dispose();
}
console.log(`\nSession model cost: $${sessionCost.toFixed(4)}`);
