/**
 * Spike 2 (APP-004 / XC-005): run a Lore owner skill under Pi with the exact
 * desktop tool surface, in the terminal, before any Electron exists.
 *
 *   npm run harness                          # lore-capture, temp Lore home
 *   npm run harness -- lore-onboard          # another skill
 *   npm run harness -- lore-capture --real   # against the real ~/.lore (attended!)
 *
 * Proves (or disproves): the SKILL.md loads verbatim as instructions and the
 * skill completes with only lore_cli + read_context_file + ask_user. Any step
 * that needs more is a skill bug to fix in the skill, not a reason to widen
 * the surface.
 */
import { mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Agent, type StreamFn } from "@earendil-works/pi-agent-core";
import { createModels } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { FileCredentialStore } from "./store.js";
import { ask } from "./interaction.js";
import { createLoreTools } from "./lore-tools.js";

const args = process.argv.slice(2);
const skillName = args.find((a) => !a.startsWith("--")) ?? "lore-capture";
const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");
const skillsDir = join(repoRoot, "plugins/lore/skills");
const skill = readFileSync(join(skillsDir, skillName, "SKILL.md"), "utf8");

const loreHome = args.includes("--real") ? join(homedir(), ".lore") : join(homedir(), ".lore-spike-home");
mkdirSync(loreHome, { recursive: true });
console.log(`Skill: ${skillName}\nLore home: ${loreHome}\n`);

const store = new FileCredentialStore(join(homedir(), ".lore", "spike-credentials.json"));
const models = createModels({ credentials: store });
models.setProvider(anthropicProvider());
models.setProvider(openaiCodexProvider());

const preferred = process.env.LORE_SPIKE_MODEL ?? "claude-sonnet-5";
const available = await models.getAvailable();
const model = available.find(({ id }) => id === preferred) ?? available.at(0);
if (!model) {
  throw new Error(
    "No configured provider. Run `npm run auth` first, or export ANTHROPIC_API_KEY."
  );
}
console.log(`Model: ${model.id}\n`);

const streamFn: StreamFn = (nextModel, context, options) =>
  models.streamSimple(nextModel, context, { ...options, maxTokens: 4096 });

const systemPrompt =
  "You are the Lore desktop app's embedded agent. The owner talks to you in a chat " +
  "panel; you have exactly four tools (lore_cli, read_context_file, ask_user, " +
  "load_skill) and no shell. Follow the skill below as your instructions. When the " +
  "skill routes to another skill (publish, enable payments, capture, onboard), call " +
  "load_skill and continue in that flow. Where the skill mentions " +
  "installing Lore, skip it — the runtime is already provisioned. Where it mentions " +
  "AskUserQuestion or asking in chat, use ask_user for structured decisions and plain " +
  "chat for open conversation. Approvals happen outside your tools: when the owner " +
  "must approve something, present it and tell them the app will show an approval " +
  "card (in this terminal harness, they approve by replying).\n\n" +
  "----- SKILL -----\n\n" +
  skill;

const agent = new Agent({
  streamFn,
  toolExecution: "sequential",
  initialState: {
    systemPrompt,
    model,
    tools: createLoreTools(loreHome, skillsDir)
  }
});

let sessionCost = 0;
agent.subscribe((event) => {
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
let opening = "The owner just opened the capture input. Greet them and begin the skill.";
for (;;) {
  await agent.prompt(opening);
  const line = (await ask("you> ")).trim();
  if (line === "quit" || line === "exit") break;
  opening = line;
}
console.log(`\nSession model cost: $${sessionCost.toFixed(4)}`);
