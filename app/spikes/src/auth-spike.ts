import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthType } from "@earendil-works/pi-ai";
import { LoreKernel } from "./kernel.js";
import { FileCredentialStore } from "./store.js";
import { Terminal } from "./terminal.js";

const providerId = process.argv[2] ?? "anthropic";
const authType = (process.argv[3] ?? "oauth") as AuthType;
const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../..");

const kernel = await LoreKernel.create({
  loreHome: join(homedir(), ".lore-spike-home"),
  skillsDir: join(repoRoot, "plugins/lore/skills"),
  credentials: new FileCredentialStore(join(homedir(), ".lore", "spike-credentials.json")),
  owner: new Terminal()
});
const { models } = kernel;

const existing = await models.checkAuth(providerId);
if (existing) {
  console.log(`Already configured: ${providerId} via ${existing.source ?? existing.type}`);
} else {
  console.log(`Logging in to ${providerId} (${authType})…`);
  await models.login(providerId, authType, new Terminal());
  console.log("Login complete; credential persisted.");
}

const auth = await models.getAuth(providerId);
if (!auth) throw new Error(`getAuth resolved nothing for ${providerId}`);
console.log(`Resolved auth source: ${auth.source ?? "unknown"}`);

await models.refresh({ providers: [providerId] });
const model = models.getModel("anthropic", "claude-sonnet-5") ?? models.getModels(providerId).at(0);
if (!model) throw new Error(`no models known for ${providerId}`);
console.log(`Calling ${model.id}…`);

const message = await models.completeSimple(model, {
  messages: [{ role: "user", content: "Reply with the single word: ok", timestamp: Date.now() }]
});
const text = message.content
  .map((block) => (block.type === "text" ? block.text : ""))
  .join("")
  .trim();
console.log(`Model replied: ${JSON.stringify(text)}`);
console.log(`Cost: $${message.usage.cost.total.toFixed(6)} (${message.usage.input} in / ${message.usage.output} out)`);
console.log("\nSPIKE PASS: login → stored credential → resolved auth → real completion.");
