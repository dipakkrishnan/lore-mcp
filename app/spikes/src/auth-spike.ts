/**
 * Spike 1 (APP-003): prove subscription sign-in end to end without Electron.
 *
 *   npm run auth                    # Claude subscription OAuth
 *   npm run auth -- openai-codex    # ChatGPT subscription OAuth
 *   npm run auth -- anthropic api_key
 *
 * Proves: pi-ai OAuth login → credential persisted through a CredentialStore
 * (file here, safeStorage in the app) → getAuth resolves with refresh →
 * one real model call succeeds through Models.completeSimple.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { createModels, type AuthType } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { FileCredentialStore } from "./store.js";
import { terminalInteraction } from "./interaction.js";

const providerId = process.argv[2] ?? "anthropic";
const authType = (process.argv[3] ?? "oauth") as AuthType;

const store = new FileCredentialStore(join(homedir(), ".lore", "spike-credentials.json"));
const models = createModels({ credentials: store });
models.setProvider(anthropicProvider());
models.setProvider(openaiCodexProvider());

const existing = await models.checkAuth(providerId);
if (existing) {
  console.log(`Already configured: ${providerId} via ${existing.source ?? existing.type}`);
} else {
  console.log(`Logging in to ${providerId} (${authType})…`);
  await models.login(providerId, authType, terminalInteraction());
  console.log("Login complete; credential persisted.");
}

const auth = await models.getAuth(providerId);
if (!auth) throw new Error(`getAuth resolved nothing for ${providerId}`);
console.log(`Resolved auth source: ${auth.source ?? "unknown"}`);

await models.refresh({ providers: [providerId] });
const model =
  models.getModel("anthropic", "claude-sonnet-5") ??
  models.getModels(providerId).at(0);
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
