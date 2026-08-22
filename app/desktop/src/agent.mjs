import { resolve } from "node:path";
import {
  createAgentSession,
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
  /^lore search(?: (?:[A-Za-z0-9][A-Za-z0-9._:/-]*|--status (?:private|discarded)|--limit (?:0|[1-9]\d*)|--json))*$/
];
const CAPTURE_BASH = /^lore capture apply - <<'LORE_CAPTURE'\n([\s\S]+)\nLORE_CAPTURE$/;

/** @param {string} command @returns {"allow" | "approve" | "deny"} */
export function classifyBash(command) {
  if (READ_ONLY_BASH.some((pattern) => pattern.test(command))) return "allow";
  const capture = command.match(CAPTURE_BASH);
  if (!capture) return "deny";
  try {
    return Array.isArray(JSON.parse(capture[1])) ? "approve" : "deny";
  } catch {
    return "deny";
  }
}

/**
 * @param {(command: string) => Promise<boolean>} approve
 * @param {(decision: "auto-allowed" | "blocked") => void} report
 */
export function bashPolicyExtension(approve, report = () => {}) {
  return {
    name: "bash-policy",
    hidden: true,
    /** @param {import("@earendil-works/pi-coding-agent").ExtensionAPI} pi */
    factory(pi) {
      pi.on("tool_call", async (event) => {
        if (!isToolCallEventType("bash", event)) return;
        const decision = classifyBash(event.input.command);
        if (decision === "allow") {
          report("auto-allowed");
          return;
        }
        if (decision === "approve" && (await approve(event.input.command))) return;
        if (decision === "deny") report("blocked");
        return {
          block: true,
          reason:
            decision === "deny"
              ? "Lore blocked a command outside the desktop capture policy."
              : "The owner denied this private save.",
          terminate: true
        };
      });
    }
  };
}

export class LoreAgent {
  /** @type {import("@earendil-works/pi-coding-agent").AgentSession | undefined} */
  #session;
  #busy = false;

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
    process.env.LORE_HOME = options.loreHome;
    process.env.NO_COLOR = "1";
    const models = await ModelRuntime.create({ credentials: options.credentials });
    const settings = SettingsManager.inMemory();
    const resources = new DefaultResourceLoader({
      cwd: options.loreHome,
      agentDir: resolve(options.loreHome, ".pi"),
      settingsManager: settings,
      additionalSkillPaths: [options.skillsDir],
      extensionFactories: [bashPolicyExtension(options.approveBash, options.reportBash)],
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: [
        "You are Lore's attended desktop capture agent.",
        "Use the lore-capture skill exactly; skip install steps because Lore is already provisioned.",
        "Use native read and Bash only for this capture, and use ask_user for structured decisions.",
        "For read-only checks, Bash may use only: lore status, lore desktop-state, or token-safe lore search arguments.",
        "When invoking Bash to save, use exactly this shape with real newlines: lore capture apply - <<'LORE_CAPTURE' newline JSON array newline LORE_CAPTURE.",
        "Do not use echo, printf, a pipe, a temporary file, or any other redirect.",
        "Never publish, price, deploy, enable payments, or run attended approval commands in this build.",
        "Bash policy is enforced outside this prompt: safe reads run automatically, recognized private saves require approval, and everything else is blocked."
      ].join(" ")
    });
    await resources.reload();
    return new LoreAgent(options, models, settings, resources);
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

  /** @param {string} text */
  async prompt(text) {
    if (this.#busy) throw new Error("Lore is already working");
    if (!text.trim()) throw new Error("Capture text is empty");
    this.#busy = true;
    this.options.emit({ type: "working", active: true });
    try {
      const session = await this.#getSession();
      const input = session.messages.length ? text : `/skill:lore-capture\n\n${text}`;
      await session.prompt(input);
    } finally {
      this.#busy = false;
      this.options.emit({ type: "working", active: false });
    }
  }

  dispose() {
    this.#session?.dispose();
  }

  async #getSession() {
    if (this.#session) return this.#session;
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
      customTools: [this.#askTool()]
    });
    session.subscribe((event) => {
      if (event.type === "tool_execution_start") {
        this.options.emit({ type: "tool", name: event.toolName, active: true });
      } else if (event.type === "tool_execution_end") {
        this.options.emit({
          type: "tool",
          name: event.toolName,
          active: false,
          failed: event.isError
        });
      } else if (event.type === "message_end" && event.message.role === "assistant") {
        const text = event.message.content
          .map((block) => (block.type === "text" ? block.text : ""))
          .join("")
          .trim();
        if (text) this.options.emit({ type: "message", text });
      }
    });
    this.#session = session;
    return session;
  }

  #askTool() {
    const parameters = Type.Object({
      questions: Type.Array(
        Type.Object({
          question: Type.String(),
          header: Type.String(),
          options: Type.Array(
            Type.Object({ label: Type.String(), description: Type.String() })
          ),
          multiSelect: Type.Boolean()
        }),
        { minItems: 1, maxItems: 4 }
      )
    });
    return defineTool({
      name: "ask_user",
      label: "Ask the owner",
      description: "Ask the owner structured questions during an attended Lore capture.",
      parameters,
      execute: async (_id, { questions }) => ({
        content: [
          {
            type: "text",
            text: JSON.stringify({ answers: await this.options.askUser(questions) })
          }
        ],
        details: {}
      })
    });
  }
}
