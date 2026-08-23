import { resolve } from "node:path";
import {
  createAgentSession,
  createBashTool,
  DefaultResourceLoader,
  defineTool,
  isToolCallEventType,
  ModelRuntime,
  resolveModelScopeWithDiagnostics,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";

/** @type {Array<[RegExp, "allow" | "draft" | "checkpoint" | BashAction["kind"]]>} */
const BASH_POLICY = [
  [/^lore status$/, "allow"],
  [/^lore desktop-state$/, "allow"],
  [/^lore search(?: (?:[A-Za-z0-9][A-Za-z0-9._:/-]*|--status (?:private|discarded)|--limit (?:0|[1-9]\d*)|--json))*$/, "allow"],
  [/^lore blueprint show$/, "allow"],
  [/^lore publication list$/, "allow"],
  [/^lore publication draft - <<'LORE_PUBLISH'\n([\s\S]+)\nLORE_PUBLISH$/, "draft"],
  [/^which claude codex$/, "allow"],
  [/^ls "\$\{CLAUDE_HOME:-\$HOME\/\.claude\}\/projects"$/, "allow"],
  [/^ls "\$\{CLAUDE_HOME:-\$HOME\/\.claude\}"\/projects\/\*\/memory\/\*\.md 2>\/dev\/null$/, "allow"],
  [/^ls "\$\{CODEX_HOME:-\$HOME\/\.codex\}\/memories" "\$\{CODEX_HOME:-\$HOME\/\.codex\}\/automations" 2>\/dev\/null$/, "allow"],
  [/^ls -lt "\$\{CLAUDE_HOME:-\$HOME\/\.claude\}"\/projects\/\*\/\*\.jsonl 2>\/dev\/null$/, "allow"],
  [/^cat > "\$\{LORE_HOME:-\$HOME\/\.lore\}\/automation\/onboarding\.json" <<'LORE_CHECKPOINT'\n([\s\S]+)\nLORE_CHECKPOINT$/, "checkpoint"],
  [/^lore setup --yes$/, "import"],
  [/^lore capture apply - <<'LORE_CAPTURE'\n([\s\S]+)\nLORE_CAPTURE$/, "capture"],
  [/^lore blueprint apply - <<'LORE_BLUEPRINT'\n([\s\S]+)\nLORE_BLUEPRINT$/, "blueprint"],
  [/^lore profile - <<'LORE_PROFILE'\n([\s\S]+)\nLORE_PROFILE$/, "profile"]
];
const CHECKPOINT_FIELDS = {
  phase1_done: "boolean",
  role: "string",
  domains: "string",
  valuable_context: "string",
  preferences: "string",
  boundaries: "string",
  executor: "string",
  model: "string",
  cadence: "string",
  hour: "number"
};
const SKILLS = { capture: "lore-capture", setup: "lore-onboard", publish: "lore-publish" };
const MODELS = ["anthropic/claude-sonnet-5", "openai-codex/gpt-5.6-luna", "openai/gpt-5.6-luna"];

/** @param {string} command @returns {"allow" | BashAction | null} */
export function classifyBash(command) {
  for (const [pattern, kind] of BASH_POLICY) {
    const match = command.match(pattern);
    if (!match) continue;
    if (match[1] === undefined) return kind === "allow" ? kind : kind === "import" ? { kind } : null;
    /** @type {unknown} */
    let body;
    try {
      body = JSON.parse(match[1]);
    } catch {
      return null;
    }
    if (!body || typeof body !== "object") return null;
    if (kind === "draft") return Array.isArray(body) && body.length ? "allow" : null;
    if (kind === "checkpoint") {
      const checkpoint = /** @type {Record<string, unknown>} */ (body);
      if (
        Array.isArray(body) ||
        Object.keys(checkpoint).length !== Object.keys(CHECKPOINT_FIELDS).length ||
        !Object.entries(CHECKPOINT_FIELDS).every(([key, type]) => typeof checkpoint[key] === type)
      )
        return null;
      return ["daily", "weekly"].includes(/** @type {string} */ (checkpoint.cadence)) &&
        Number.isInteger(checkpoint.hour) &&
        /** @type {number} */ (checkpoint.hour) >= 0 &&
        /** @type {number} */ (checkpoint.hour) <= 23
        ? "allow"
        : null;
    }
    if (kind === "capture") {
      const entries = /** @type {CaptureEntry[]} */ (body);
      const titled = Array.isArray(body) && body.length > 0 && entries.every((entry) => entry && typeof entry.title === "string" && typeof entry.content === "string");
      return titled ? { kind, entries } : null;
    }
    if (Array.isArray(body) || kind === "import") return null;
    return kind === "allow" ? kind : { kind, fields: /** @type {Record<string, unknown>} */ (body) };
  }
  return null;
}

/** @param {(command: string, action: BashAction) => Promise<boolean>} approve */
export function bashPolicyExtension(approve) {
  return {
    name: "bash-policy",
    hidden: true,
    /** @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi */
    factory(pi) {
      pi.on("tool_call", async (event) => {
        if (!isToolCallEventType("bash", event)) return;
        const command = event.input.command;
        const action = classifyBash(command);
        if (action === "allow") return;
        if (action && (await approve(command, action))) return;
        return {
          block: true,
          reason: action ? "The owner chose not to do this." : "Lore blocked a command outside the desktop policy.",
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
      extensionFactories: [bashPolicyExtension((command, action) => agent.#approve(command, action))],
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

  /** @param {string} command @param {BashAction} action */
  async #approve(command, action) {
    const approved = await this.options.approveBash(command, action);
    if (approved && action.kind === "capture") this.#captureSaved = true;
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
        if (prompt.type === "select") return prompt.options[0].id;
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
    const { scopedModels } = await resolveModelScopeWithDiagnostics(MODELS, this.models);
    const model = scopedModels.at(0)?.model ?? (await this.models.getAvailable()).at(0);
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
            env: {
              ...context.env,
              LORE_HOME: this.options.loreHome,
              NO_COLOR: "1",
              ...(this.options.binDir ? { PATH: `${this.options.binDir}:${context.env.PATH ?? process.env.PATH ?? ""}` } : {})
            }
          })
        }),
        this.#askTool()
      ]
    });
    session.subscribe((event) => {
      if (event.type === "tool_execution_start" && event.toolName !== "ask_user") {
        this.options.emit({ type: "live", text: event.toolName === "read" ? "Reading…" : "Looking through your Lore…" });
      }
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        const text = event.assistantMessageEvent.partial.content.map((block) => (block.type === "text" ? block.text : "")).join("");
        this.options.emit({ type: "live", text });
      }
      if (event.type === "tool_execution_end" && event.toolName === "bash") this.options.emit({ type: "changed" });
      if (event.type !== "message_end" || event.message.role !== "assistant") return;
      if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
        this.options.emit({ type: "message", text: event.message.errorMessage || "Lore's model did not answer." });
        return;
      }
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
