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
const CHECKPOINT_DRAFT = {
  name: "string",
  persona: "string",
  organizing_axis: "string",
  topic_outline: "list",
  focus_topics: "list",
  general_areas: "list",
  storytelling: "string"
};
const SKILLS = { capture: "lore-capture", setup: "lore-onboard", publish: "lore-publish" };
const STOPPED = "Lore stopped before doing something it isn't allowed to do here. Tell it how to continue.";
const CLOSED = "Lore was closed before this finished.";
const MODELS = ["anthropic/claude-sonnet-5", "openai-codex/gpt-5.6-luna", "openai/gpt-5.6-luna"];

/** @param {unknown} body @returns {string[]} */
function checkpointProblems(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return ["it must be a JSON object"];
  const checkpoint = /** @type {Record<string, unknown>} */ (body);
  const problems = [];
  for (const [key, type] of Object.entries(CHECKPOINT_FIELDS)) {
    if (!(key in checkpoint)) problems.push(`"${key}" is missing`);
    else if (typeof checkpoint[key] !== type) problems.push(`"${key}" must be a ${type}`);
  }
  for (const [key, value] of Object.entries(checkpoint)) {
    if (key in CHECKPOINT_FIELDS) continue;
    const type = CHECKPOINT_DRAFT[/** @type {keyof typeof CHECKPOINT_DRAFT} */ (key)];
    if (!type) problems.push(`"${key}" is not a checkpoint field`);
    else if (type === "list" ? !Array.isArray(value) || !value.every((item) => typeof item === "string") : typeof value !== type)
      problems.push(`"${key}" must be a ${type === "list" ? "list of strings" : type}`);
  }
  if (!["daily", "weekly"].includes(/** @type {string} */ (checkpoint.cadence))) problems.push('"cadence" must be "daily" or "weekly"');
  if (!Number.isInteger(checkpoint.hour) || /** @type {number} */ (checkpoint.hour) < 0 || /** @type {number} */ (checkpoint.hour) > 23) problems.push('"hour" must be a whole number from 0 to 23');
  return problems;
}

/** @param {string} command @returns {BashVerdict} */
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
      if (kind === "checkpoint") return { kind: "malformed", reason: "The checkpoint was not saved: it is not valid JSON. Write it again with exactly the fields the skill shows." };
      return null;
    }
    if (kind === "checkpoint") {
      const problems = checkpointProblems(body);
      return problems.length ? { kind: "malformed", reason: `The checkpoint was not saved: ${problems.join("; ")}. Write it again with exactly the fields the skill shows.` } : "allow";
    }
    if (!body || typeof body !== "object") return null;
    if (kind === "draft") return Array.isArray(body) && body.length ? "allow" : null;
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

/** @param {(command: string, action: BashAction) => Promise<boolean>} approve @param {() => void} [stopped] */
export function bashPolicyExtension(approve, stopped = () => {}) {
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
        if (action?.kind === "malformed") return { block: true, reason: action.reason };
        if (action) return (await approve(command, action)) ? undefined : { block: true, reason: "The owner chose not to do this. Ask them how to continue." };
        stopped();
        return { block: true, reason: "Lore blocked a command outside the desktop policy.", terminate: true };
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
      extensionFactories: [bashPolicyExtension((command, action) => agent.#approve(command, action), () => options.emit({ type: "stopped", text: STOPPED }))],
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: [
        "You are Lore's desktop agent, talking with the owner inside the Lore app.",
        "Follow the skill named in the first message exactly and skip its install steps because Lore is already provisioned.",
        "Ask the owner everything through ask_user — decisions and open questions alike; offer the likely answers as options, and the owner can always type their own. Never end a turn with a question in prose.",
        "Never mention tools, commands, or files to the owner; speak about memories, their Lore, and their store.",
        "Bash policy is enforced outside this prompt."
      ].join(" ")
    });
    await resources.reload();
    agent = new LoreAgent(options, models, settings, resources);
    return agent;
  }

  /** @param {string} loreHome @param {AgentTask} task */
  static sessionFor(loreHome, task) {
    const dir = resolve(loreHome, ".pi", "sessions", task);
    const manager = task === "setup" ? SessionManager.continueRecent(loreHome, dir) : SessionManager.create(loreHome, dir);
    const last = manager.buildSessionContext().messages.at(-1);
    if (last?.role === "assistant") {
      for (const block of last.content) {
        if (block.type === "toolCall") {
          manager.appendMessage({ role: "toolResult", toolCallId: block.id, toolName: block.name, content: [{ type: "text", text: CLOSED }], isError: true, timestamp: Date.now() });
        }
      }
    }
    return manager;
  }

  /** @param {string} loreHome @param {AgentTask} task @returns {Line[]} */
  static history(loreHome, task) {
    const { messages } = SessionManager.continueRecent(loreHome, resolve(loreHome, ".pi", "sessions", task)).buildSessionContext();
    /** @type {Line[]} */
    const lines = [];
    for (const message of messages) {
      if (message.role === "user") {
        const text = typeof message.content === "string" ? message.content : message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
        lines.push({ text: text.replace(/^\/skill:\S+\n\n/, ""), owner: true });
      } else if (message.role === "assistant") {
        const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("").trim();
        if (text) lines.push({ text, owner: false });
      } else if (message.role === "toolResult" && message.toolName === "ask_user" && !message.isError) {
        const first = message.content[0];
        if (first?.type !== "text") continue;
        try {
          const result = /** @type {{answers?: Record<string, unknown>}} */ (JSON.parse(first.text));
          const answers = result.answers && !Array.isArray(result.answers)
            ? Object.values(result.answers).filter((value) => typeof value === "string" && value).join(" · ")
            : "";
          if (answers) lines.push({ text: answers, owner: true });
        } catch {
          // An old or interrupted tool result should not hide the rest of the thread.
        }
      }
    }
    return lines;
  }

  /** @param {AgentTask} task */
  history(task) {
    return LoreAgent.history(this.options.loreHome, task);
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
      const [session, resumed] = existing ? [existing, true] : await this.#newSession(task);
      await session.prompt(resumed ? text : `/skill:${SKILLS[task]}\n\n${text}`);
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

  /** @param {AgentTask} task @returns {Promise<[import("@earendil-works/pi-coding-agent").AgentSession, boolean]>} */
  async #newSession(task) {
    const { scopedModels } = await resolveModelScopeWithDiagnostics(MODELS, this.models);
    const model = scopedModels.at(0)?.model ?? (await this.models.getAvailable()).at(0);
    if (!model) throw new Error("Sign in with Claude, ChatGPT, or an API key first");
    const sessionManager = LoreAgent.sessionFor(this.options.loreHome, task);
    const resumed = sessionManager.buildSessionContext().messages.length > 0;
    const { session } = await createAgentSession({
      cwd: this.options.loreHome,
      agentDir: resolve(this.options.loreHome, ".pi"),
      modelRuntime: this.models,
      model,
      resourceLoader: this.resources,
      settingsManager: this.settings,
      sessionManager,
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
    return [session, resumed];
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
