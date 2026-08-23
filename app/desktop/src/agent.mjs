import { resolve } from "node:path";
import {
  createAgentSession,
  createBashTool,
  DefaultResourceLoader,
  defineTool,
  isToolCallEventType,
  ModelRuntime,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

const READ_ONLY_BASH = [
  /^lore status$/,
  /^lore desktop-state$/,
  /^lore blueprint show$/,
  /^lore publication list$/,
  /^lore search(?: (?:[A-Za-z0-9][A-Za-z0-9._:/-]*|--status (?:private|discarded)|--limit (?:0|[1-9]\d*)|--json))*$/
];
const CAPTURE_BASH = /^lore capture apply - <<'LORE_CAPTURE'\n([\s\S]+)\nLORE_CAPTURE$/;
const DRAFT_BASH = /^lore publication draft - <<'LORE_PUBLISH'\n([\s\S]+)\nLORE_PUBLISH$/;
const SKILLS = { capture: "lore-capture", setup: "lore-onboard", publish: "lore-publish" };

/** @param {string} command @param {RegExp} pattern @returns {unknown[] | null} */
function heredocArray(command, pattern) {
  const match = command.match(pattern);
  if (!match) return null;
  try {
    /** @type {unknown} */
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {string} command @returns {CaptureEntry[] | null} */
export function captureEntries(command) {
  const entries = /** @type {CaptureEntry[] | null} */ (heredocArray(command, CAPTURE_BASH));
  return entries?.every((entry) => entry && typeof entry.title === "string" && typeof entry.content === "string")
    ? entries
    : null;
}

/** @param {string} command @returns {"allow" | "approve" | "deny"} */
export function classifyBash(command) {
  if (READ_ONLY_BASH.some((pattern) => pattern.test(command)) || heredocArray(command, DRAFT_BASH)) return "allow";
  return captureEntries(command) ? "approve" : "deny";
}

/** @param {(command: string, entries: CaptureEntry[]) => Promise<boolean>} approve */
export function bashPolicyExtension(approve) {
  return {
    name: "bash-policy",
    hidden: true,
    /** @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi */
    factory(pi) {
      pi.on("tool_call", async (event) => {
        if (!isToolCallEventType("bash", event)) return;
        const command = event.input.command;
        const decision = classifyBash(command);
        if (decision === "allow") return;
        if (decision === "approve" && (await approve(command, captureEntries(command) ?? []))) return;
        return {
          block: true,
          reason:
            decision === "deny"
              ? "Lore blocked a command outside the desktop policy."
              : "The owner chose not to save this.",
          terminate: true
        };
      });
    }
  };
}

export class LoreAgent {
  /** @type {Map<AgentTask, import("@earendil-works/pi-coding-agent").AgentSession>} */
  #sessions = new Map();
  #busy = false;
  #captureSaved = false;

  /**
   * @param {LoreAgentOptions} options
   * @param {import("@earendil-works/pi-coding-agent").ModelRuntime} models
   * @param {import("@earendil-works/pi-coding-agent").SettingsManager} settings
   * @param {import("@earendil-works/pi-coding-agent").DefaultResourceLoader} resources
   */
  constructor(options, models, settings, resources) {
    this.options = options;
    this.models = models;
    this.settings = settings;
    this.resources = resources;
  }

  /** @param {LoreAgentOptions} options */
  static async create(options) {
    /** @type {LoreAgent} */
    let agent;
    const models = await ModelRuntime.create({ credentials: options.credentials });
    const settings = SettingsManager.inMemory();
    const resources = new DefaultResourceLoader({
      cwd: options.loreHome,
      agentDir: resolve(options.loreHome, ".pi"),
      settingsManager: settings,
      additionalSkillPaths: [options.skillsDir],
      extensionFactories: [bashPolicyExtension((command, entries) => agent.#approve(command, entries))],
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: [
        "You are Lore's desktop agent, talking with the owner inside the Lore app.",
        "Follow the skill named in the first message exactly and skip its install steps because Lore is already provisioned.",
        "Use ask_user for every owner decision. Never mention tools, commands, or files to the owner; speak about memories, their Lore, and their store.",
        "Bash policy is enforced outside this prompt."
      ].join(" ")
    });
    await resources.reload();
    agent = new LoreAgent(options, models, settings, resources);
    return agent;
  }

  /** @param {string} command @param {CaptureEntry[]} entries */
  async #approve(command, entries) {
    const approved = await this.options.approveBash(command, entries);
    if (approved) this.#captureSaved = true;
    return approved;
  }

  async status() {
    return { credentials: await this.options.credentials.list(), busy: this.#busy };
  }

  /** @param {string} providerId @param {"oauth" | "api_key"} type @param {string | undefined} secret */
  async login(providerId, type, secret) {
    /** @type {import("@earendil-works/pi-ai").AuthInteraction} */
    const interaction = {
      prompt: async (prompt) => {
        if (prompt.type === "secret" && secret) return secret;
        return this.options.authPrompt(prompt);
      },
      notify: (event) => this.options.authEvent(event)
    };
    await this.models.login(providerId, type, interaction);
    return this.status();
  }

  /** @param {string} providerId */
  async logout(providerId) {
    await this.options.credentials.delete(providerId);
    this.dispose();
    return this.status();
  }

  /** @param {string} text @param {AgentTask} task */
  async prompt(text, task) {
    if (this.#busy) throw new Error("Lore is already working");
    if (!text.trim()) throw new Error("Nothing to capture");
    this.#busy = true;
    this.options.emit({ type: "working", active: true });
    try {
      if (task === "publish" || (task === "capture" && this.#captureSaved)) {
        this.#sessions.get(task)?.dispose();
        this.#sessions.delete(task);
        this.#captureSaved = false;
      }
      const existing = this.#sessions.get(task);
      const session = existing ?? (await this.#newSession(task));
      await session.prompt(existing ? text : `/skill:${SKILLS[task]}\n\n${text}`);
    } finally {
      this.#busy = false;
      this.options.emit({ type: "working", active: false });
    }
  }

  dispose() {
    for (const session of this.#sessions.values()) session.dispose();
    this.#sessions.clear();
    this.#captureSaved = false;
  }

  /** @param {AgentTask} task */
  async #newSession(task) {
    const available = await this.models.getAvailable();
    const model =
      available.find(({ provider, id }) => provider === "anthropic" && id.includes("sonnet")) ??
      available.find(({ provider }) => provider === "openai-codex") ??
      available.at(0);
    if (!model) throw new Error("Sign in with Claude, ChatGPT, or an API key first");
    const { session } = await createAgentSession({
      cwd: this.options.loreHome,
      agentDir: resolve(this.options.loreHome, ".pi"),
      modelRuntime: this.models,
      model,
      resourceLoader: this.resources,
      settingsManager: this.settings,
      sessionManager: SessionManager.inMemory(this.options.loreHome),
      tools: ["read", "bash", "ask_user"],
      customTools: [
        createBashTool(this.options.loreHome, {
          spawnHook: (context) => ({
            ...context,
            env: { ...context.env, LORE_HOME: this.options.loreHome, NO_COLOR: "1" }
          })
        }),
        this.#askTool()
      ]
    });
    session.subscribe((event) => {
      if (event.type !== "message_end" || event.message.role !== "assistant") return;
      const text = event.message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
      if (text) this.options.emit({ type: "message", text });
    });
    this.#sessions.set(task, session);
    return session;
  }

  #askTool() {
    const parameters = Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String(),
          header: Type.String(),
          options: Type.Array(Type.Object({ label: Type.String(), description: Type.String() })),
          multiSelect: Type.Boolean()
        }),
        { minItems: 1, maxItems: 4 }
      )
    });
    return defineTool({
      name: "ask_user",
      label: "Ask the owner",
      description: "Ask the owner structured questions. Offer the likely answers as options; the owner can always type something else.",
      parameters,
      execute: async (_id, { questions }) => ({
        content: [{ type: "text", text: JSON.stringify({ answers: await this.options.askUser(questions) }) }],
        details: {}
      })
    });
  }
}
