// A scripted stand-in for Lore's desktop agent, shared by the sandbox and agent tests (APP-248).
const assert = require("node:assert/strict");
const { mkdtemp } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

/** A LoreAgent whose model is pi's scripted stand-in, so a whole turn runs without a provider. @param {Partial<LoreAgentOptions>} options */
async function scriptedAgent(options) {
  const { fauxProvider, InMemoryCredentialStore } = await import("@earendil-works/pi-ai");
  const { DefaultResourceLoader, ModelRuntime, SettingsManager } = await import("@earendil-works/pi-coding-agent");
  const { LoreAgent } = await import("../src/agent.mjs");
  const loreHome = await mkdtemp(join(tmpdir(), "lore-reading-"));
  const models = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), refreshOnCreate: false });
  const faux = fauxProvider();
  models.registerNativeProvider(faux.provider);
  const settings = SettingsManager.inMemory();
  const resources = new DefaultResourceLoader({ cwd: loreHome, agentDir: join(loreHome, ".pi"), settingsManager: settings, additionalSkillPaths: [join(__dirname, "../../../plugins/lore/skills")], noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true, systemPrompt: "You are a scripted stand-in for Lore's desktop agent." });
  await resources.reload();
  /** @type {AgentEvent[]} */
  const events = [];
  const agent = new LoreAgent(/** @type {LoreAgentOptions} */ ({ loreHome, skillsDir: "", emit: (event) => events.push(event), ...options }), models, settings, resources);
  return { agent, faux, events, loreHome };
}

/** Wait until `done` holds, or fail after a few seconds. @param {() => boolean} done */
async function until(done) {
  for (let tries = 0; tries < 200 && !done(); tries++) await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(done(), "timed out");
}

module.exports = { scriptedAgent, until };
