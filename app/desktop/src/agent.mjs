import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  createAgentSession,
  createBashTool,
  createLocalBashOperations,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  resolveModelScopeWithDiagnostics,
  SessionManager,
  SettingsManager
} from "@earendil-works/pi-coding-agent";
import { Type } from "@earendil-works/pi-ai";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

const SKILLS = { capture: "lore-capture", setup: "lore-onboard", publish: "lore-publish", deploy: "lore-enable-payments" };
const TASKS = {
  capture: { title: "Capture a memory", phase: "Review the capture" },
  setup: { title: "Set up your Lore", phase: "Shape your Lore" },
  publish: { title: "Publish from your Lore", phase: "Draft publications" },
  deploy: { title: "Open your store", phase: "Payout, price, deploy" }
};
const TASK_STATES = new Set(["needs_you", "working", "stopped", "done"]);
const PERSONAS = ["storyteller", "schoolteacher", "professor", "executive", "sage"];
const AXES = ["chronological", "theme", "project", "knowledge"];
const CLOSED = "Lore was closed before this finished.";
export const MODELS = ["anthropic/claude-opus-4-8", "anthropic/claude-sonnet-5", "openai-codex/gpt-5.6-luna", "openai/gpt-5.6-luna"];
const MAX_TURNS = 60;
const SANDBOX_TMPDIR = "/tmp/claude";
/** @type {Partial<Record<AgentTask, string[]>>} Home-relative directories outside Lore that a task's commands must write. */
const OWNER_DIRS = {
  setup: [".codex/automations", "Library/LaunchAgents"],
  deploy: [".wrangler", "Library/Preferences/.wrangler", "Library/Caches/.wrangler", ".npm"]
};
const CAPPED = "That reply took more steps than Lore allows at once, so it paused. Say continue to keep going.";
const KEY_REJECTED = /\b401\b|authentication_error|invalid[_ -](?:x-)?api[_ -]?key|incorrect api key/i;

/** @param {string} loreHome @param {AgentTask} task @param {string} [binDir] */
export function bashSandboxPolicy(loreHome, task, binDir) {
  const home = homedir();
  const lore = realpathSync(loreHome);
  const owned = (OWNER_DIRS[task] ?? []).map((dir) => resolve(home, dir));
  // Contents/, not just Resources/: node/bin/node is a shim onto Contents/MacOS/Lore,
  // which dyld loads from Contents/Frameworks — all must stay readable under $HOME.
  const runtime = binDir
    ? [resolve(binDir, ".."), ...(process.resourcesPath ? [resolve(process.resourcesPath, "..")] : [])]
    : [resolve(home, ".local/bin/lore"), resolve(home, ".local/share/lore/lore-mcp"), resolve(home, ".local/share/uv/python"), resolve(home, ".local/share/uv/tools/lore-mcp")];
  return {
    network: { allowedDomains: task === "deploy" ? ["*"] : [], deniedDomains: [] },
    filesystem: {
      denyRead: [home],
      allowRead: [lore, ...runtime, resolve(home, ".claude/projects"), resolve(home, ".codex/memories"), ...owned, ...(task === "deploy" ? [resolve(home, ".npmrc")] : [])],
      allowWrite: [lore, ...owned],
      denyWrite: []
    }
  };
}

/** @param {string} loreHome @param {string} [binDir] */
export async function initializeBashSandbox(loreHome, binDir) {
  mkdirSync(loreHome, { recursive: true, mode: 0o700 });
  mkdirSync(SANDBOX_TMPDIR, { recursive: true });
  await SandboxManager.initialize(bashSandboxPolicy(loreHome, "capture", binDir), undefined, true);
}

/** @param {string} loreHome @param {AgentTask} task @param {string} [binDir] @returns {import("@earendil-works/pi-coding-agent").BashOperations} */
export function createSandboxedBashOperations(loreHome, task, binDir) {
  const local = createLocalBashOperations();
  return {
    exec: async (command, cwd, options) => {
      const id = randomUUID();
      const policy = bashSandboxPolicy(loreHome, task, binDir);
      // The mux proxy's live network filter reads the session-level config set by
      // initialize()/updateConfig(), never the customConfig passed to wrapWithSandbox
      // below — so without this, every task is filtered against whichever task's
      // policy initializeBashSandbox() started the session with (always "capture").
      SandboxManager.updateConfig(policy);
      const wrapped = await SandboxManager.wrapWithSandbox(command, undefined, policy, options.signal, { commandId: id, commandText: command });
      try {
        const result = await local.exec(wrapped, cwd, options);
        const violations = SandboxManager.annotateStderrWithSandboxFailures(id, "");
        if (violations) options.onData(Buffer.from(violations));
        return result;
      } finally {
        SandboxManager.cleanupAfterCommand();
      }
    }
  };
}

/** @param {unknown} value @returns {value is BlueprintFields} */
export function validBlueprint(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const fields = /** @type {Record<string, unknown>} */ (value);
  const allowed = new Set(["version", "name", "persona", "organizing_axis", "topic_outline", "focus_topics", "general_areas", "storytelling"]);
  if (Object.keys(fields).some((key) => !allowed.has(key))) return false;
  const list = (/** @type {unknown} */ items) => Array.isArray(items) && items.length <= 50 && items.every((item) => typeof item === "string" && item.length <= 300);
  return fields.version === 1
    && typeof fields.name === "string" && fields.name.length > 0 && fields.name.length <= 200
    && PERSONAS.includes(/** @type {string} */ (fields.persona))
    && (fields.organizing_axis === undefined || AXES.includes(/** @type {string} */ (fields.organizing_axis)))
    && Array.isArray(fields.topic_outline) && fields.topic_outline.length > 0 && list(fields.topic_outline)
    && list(fields.focus_topics) && list(fields.general_areas)
    && typeof fields.storytelling === "string" && fields.storytelling.length > 0 && fields.storytelling.length <= 1000;
}

/** @param {unknown} value @returns {value is SavedMemory[]} */
export function validSaved(value) {
  return Array.isArray(value) && value.every((item) => item && typeof item === "object" && Number.isInteger(item.id) && item.id > 0 && typeof item.title === "string");
}

/** The entries an owner may keep from a memory card: the tool's own limits, and nothing blank. @param {unknown} value @returns {value is ProposedMemory[]} */
export function validEntries(value) {
  return Array.isArray(value) && value.length <= 5 && value.every((item) => item && typeof item === "object"
    && typeof item.title === "string" && item.title.trim() !== "" && item.title.length <= 300
    && typeof item.content === "string" && item.content.trim() !== "" && item.content.length <= 20_000
    && (item.project === undefined || typeof item.project === "string")
    && (item.source_path === undefined || typeof item.source_path === "string"));
}

/** The parsed JSON of a finished tool result, or null for an error, a non-text result, or an old malformed one. @param {import("@earendil-works/pi-ai").ToolResultMessage} message @returns {Record<string, any> | null} */
function toolResultJson(message) {
  const first = message.content[0];
  if (message.isError || first?.type !== "text") return null;
  try {
    const parsed = JSON.parse(first.text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** @param {import("@earendil-works/pi-coding-agent").SessionManager} manager @param {AgentTask} kind @returns {TaskRecord | null} */
export function latestTaskRecord(manager, kind) {
  for (const entry of [...manager.getEntries()].reverse()) {
    if (entry.type !== "custom" || entry.customType !== "lore.task") continue;
    const data = entry.data;
    if (!data || typeof data !== "object" || Array.isArray(data)) continue;
    const record = /** @type {Record<string, unknown>} */ (data);
    if (record.version !== 1 || record.kind !== kind || record.title !== TASKS[kind].title || !TASK_STATES.has(/** @type {string} */ (record.state)) || typeof record.phase !== "string") continue;
    return /** @type {TaskRecord} */ ({ ...record, updatedAt: entry.timestamp });
  }
  return null;
}

/** @param {import("@earendil-works/pi-coding-agent").SessionManager} manager @param {AgentTask} kind @param {TaskState} state @param {string} [phase] */
function appendTaskRecord(manager, kind, state, phase = TASKS[kind].phase) {
  const current = latestTaskRecord(manager, kind);
  if (current?.state === state && current.phase === phase) return current;
  manager.appendCustomEntry("lore.task", { version: 1, kind, title: TASKS[kind].title, state, phase });
  return /** @type {TaskRecord} */ ({ version: 1, kind, title: TASKS[kind].title, state, phase, updatedAt: new Date().toISOString() });
}

/** @param {TaskState | undefined} state @param {AgentTask} task @param {boolean} completed @returns {[TaskState, string] | null} */
export function closingRecord(state, task, completed) {
  if (state !== "working") return null;
  return completed || task === "publish" ? ["done", "Finished"] : ["stopped", "Ready to resume"];
}

/** @param {import("@earendil-works/pi-coding-agent").SessionManager} manager @param {AgentTask} task */
function repairInterrupted(manager, task) {
  const last = manager.buildSessionContext().messages.at(-1);
  if (last?.role !== "assistant") return manager;
  let interrupted = false;
  for (const block of last.content) {
    if (block.type !== "toolCall") continue;
    manager.appendMessage({ role: "toolResult", toolCallId: block.id, toolName: block.name, content: [{ type: "text", text: CLOSED }], isError: true, timestamp: Date.now() });
    interrupted = true;
  }
  if (interrupted) appendTaskRecord(manager, task, "stopped", "Ready to resume");
  return manager;
}

export class LoreAgent {
  /** @type {Map<AgentTask, import("@earendil-works/pi-coding-agent").AgentSession>} */
  #sessions = new Map();
  #busy = false;
  #completed = false;
  #turns = 0;
  #capped = false;
  /** @type {AgentTask | null} */
  #activeTask = null;

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
    await initializeBashSandbox(options.loreHome, options.binDir);
    const models = await ModelRuntime.create({ credentials: options.credentials });
    const settings = SettingsManager.inMemory();
    const resources = new DefaultResourceLoader({
      cwd: options.loreHome,
      agentDir: resolve(options.loreHome, ".pi"),
      settingsManager: settings,
      additionalSkillPaths: [options.skillsDir],
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: [
        "You are Lore's desktop agent, talking with the owner inside the Lore app.",
        "Follow the skill named in the latest message that names one exactly, and skip its install steps because Lore is already provisioned.",
        "Ask the owner everything through ask_user — decisions and open questions alike; offer the likely answers as options, and the owner can always type their own. Never end a turn with a question in prose.",
        "Keep every message light: a sentence or two, question text under fifteen words, option labels of a few words with one short description, and never restate what a card already shows.",
        "During capture, show proposed memories only through propose_memories, never in prose; that tool saves what the owner keeps and returns the saved memories, or returns the owner's correction for you to revise and propose again. After it saves, say one short sentence and call finish_task; never offer publication, the owner starts that from the saved card.",
        "During onboarding, gather evidence first, then call propose_blueprint once with one bounded proposal; that tool saves the owner-approved shape.",
        "To set what buyers pay per publication, call propose_price and never run a price command yourself; the owner confirms the exact amount on the card, and the tool returns what they saved or null if they declined. Work from that number, not from what you proposed.",
        "Never mention tools, commands, or files to the owner; speak about memories, their Lore, and their store.",
        "Call finish_task when the current task is complete."
      ].join(" ")
    });
    await resources.reload();
    return new LoreAgent(options, models, settings, resources);
  }

  /** @param {string} loreHome @param {AgentTask} task */
  static sessionFor(loreHome, task) {
    const dir = resolve(loreHome, ".pi", "sessions", task);
    const recent = SessionManager.continueRecent(loreHome, dir);
    const record = latestTaskRecord(recent, task);
    const manager = record?.state !== "done" && (record || (task === "setup" && recent.buildSessionContext().messages.length))
      ? recent
      : SessionManager.create(loreHome, dir);
    return repairInterrupted(manager, task);
  }

  /** Start `task` as a continuation of the latest `from` thread, so the agent already knows what was said. @param {string} loreHome @param {AgentTask} from @param {AgentTask} task */
  static forkSession(loreHome, from, task) {
    const source = SessionManager.continueRecent(loreHome, resolve(loreHome, ".pi", "sessions", from)).getSessionFile();
    const dir = resolve(loreHome, ".pi", "sessions", task);
    return source && existsSync(source) ? SessionManager.forkFrom(source, loreHome, dir) : SessionManager.create(loreHome, dir);
  }

  /** @param {string} loreHome @returns {TaskRecord[]} */
  static tasks(loreHome) {
    /** @type {TaskRecord[]} */
    const records = [];
    for (const kind of /** @type {AgentTask[]} */ (Object.keys(TASKS))) {
      const record = latestTaskRecord(SessionManager.continueRecent(loreHome, resolve(loreHome, ".pi", "sessions", kind)), kind);
      if (record && record.state !== "done") records.push(record);
    }
    return records.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
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
      } else if (message.role === "toolResult") {
        const result = toolResultJson(message);
        if (!result) continue;
        if (message.toolName === "ask_user") {
          const answers = result.answers && !Array.isArray(result.answers)
            ? Object.values(result.answers).filter((value) => typeof value === "string" && value).join(" · ")
            : "";
          if (answers) lines.push({ text: answers, owner: true });
        } else if (message.toolName === "propose_memories") {
          if (typeof result.note === "string") lines.push({ text: result.note, owner: true });
          else if (validSaved(result.saved)) lines.push({ text: "", owner: false, saved: result.saved });
        } else if (message.toolName === "propose_blueprint" && validBlueprint(result)) {
          lines.push({ text: `${result.name} · ${result.persona} · ${result.topic_outline.join(", ")}`, owner: true });
        }
      }
    }
    return lines;
  }

  /** @param {AgentTask} task */
  history(task) {
    return LoreAgent.history(this.options.loreHome, task);
  }

  tasks() {
    return LoreAgent.tasks(this.options.loreHome).map((record) =>
      this.#sessions.has(record.kind) ? record : { ...record, state: /** @type {TaskState} */ ("stopped"), phase: "Ready to resume" }
    );
  }

  /** @param {import("@earendil-works/pi-coding-agent").AgentSession} session @param {AgentTask} task @param {TaskState} state @param {string} [phase] */
  #record(session, task, state, phase) {
    const record = appendTaskRecord(session.sessionManager, task, state, phase);
    this.options.emit({ type: "task", task: record });
    return record;
  }

  async status() {
    return { credentials: await this.options.credentials.list() };
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
    if (type === "api_key") await this.#proveKey(providerId);
    return this.status();
  }

  /** One tiny request, so a mistyped key fails at sign-in instead of inside the first thread. @param {string} providerId */
  async #proveKey(providerId) {
    const model = (await this.models.getAvailable(providerId)).at(0);
    const reply = model
      ? await this.models.completeSimple(model, { messages: [{ role: "user", content: "ok", timestamp: Date.now() }] }, { maxTokens: 1 }).catch((/** @type {Error} */ error) => ({ stopReason: "error", errorMessage: error.message }))
      : { stopReason: "error", errorMessage: "" };
    if (reply.stopReason !== "error") return;
    if (!KEY_REJECTED.test(reply.errorMessage ?? "")) throw new Error(reply.errorMessage || "Lore could not check that key right now. Try again.");
    await this.options.credentials.delete(providerId);
    throw new Error("That key was not accepted. Check it and try again.");
  }

  /** @param {string} providerId */
  async logout(providerId) {
    await this.options.credentials.delete(providerId);
    this.dispose();
    return this.status();
  }

  /** The task whose turn is running, so requests and messages can name the thread they belong to. */
  get activeTask() {
    return this.#activeTask;
  }

  /** @param {string} text @param {AgentTask} task @param {AgentTask} [from] Continue from the latest `from` thread instead of starting cold. */
  async prompt(text, task, from) {
    if (this.#busy) throw new Error("Lore is already working");
    if (!text.trim()) throw new Error("Nothing to capture");
    this.#busy = true;
    this.#activeTask = task;
    this.#completed = false;
    this.#turns = 0;
    this.#capped = false;
    this.options.emit({ type: "working", active: true, task });
    try {
      const open = this.#sessions.get(task);
      if (open && (from || latestTaskRecord(open.sessionManager, task)?.state === "done")) {
        open.dispose();
        this.#sessions.delete(task);
      }
      const existing = this.#sessions.get(task);
      const [session, resumed] = existing ? [existing, true] : await this.#newSession(task, from);
      this.#record(session, task, "working");
      await session.prompt(resumed ? text : `/skill:${SKILLS[task]}\n\n${text}`);
      const closing = closingRecord(latestTaskRecord(session.sessionManager, task)?.state, task, this.#completed);
      if (closing) this.#record(session, task, closing[0], closing[1]);
    } catch (error) {
      const session = this.#sessions.get(task);
      if (session && latestTaskRecord(session.sessionManager, task)?.state !== "stopped") this.#record(session, task, "stopped", "Needs another try");
      throw error;
    } finally {
      this.#busy = false;
      this.#activeTask = null;
      this.options.emit({ type: "working", active: false, task });
    }
  }

  dispose() {
    for (const session of this.#sessions.values()) session.dispose();
    this.#sessions.clear();
    this.#activeTask = null;
  }

  /** @param {AgentTask} task */
  restart(task) {
    if (this.#busy) throw new Error("Lore is still working");
    const open = this.#sessions.get(task);
    const manager = open?.sessionManager ?? SessionManager.continueRecent(this.options.loreHome, resolve(this.options.loreHome, ".pi", "sessions", task));
    const current = latestTaskRecord(manager, task);
    if (!current || current.state === "done") return;
    const record = appendTaskRecord(manager, task, "done", "Started over");
    open?.dispose();
    this.#sessions.delete(task);
    this.options.emit({ type: "task", task: record });
  }

  /** @param {AgentTask} task @param {AgentTask} [from] @returns {Promise<[import("@earendil-works/pi-coding-agent").AgentSession, boolean]>} */
  async #newSession(task, from) {
    const { scopedModels } = await resolveModelScopeWithDiagnostics(MODELS, this.models);
    const model = scopedModels.at(0)?.model ?? (await this.models.getAvailable()).at(0);
    if (!model) throw new Error("Sign in with Claude, ChatGPT, or an API key first");
    const sessionManager = from ? LoreAgent.forkSession(this.options.loreHome, from, task) : LoreAgent.sessionFor(this.options.loreHome, task);
    const resumed = !from && sessionManager.buildSessionContext().messages.length > 0;
    const { session } = await createAgentSession({
      cwd: this.options.loreHome,
      agentDir: resolve(this.options.loreHome, ".pi"),
      modelRuntime: this.models,
      model,
      resourceLoader: this.resources,
      settingsManager: this.settings,
      sessionManager,
      tools: ["read", "write", "edit", "bash", "ask_user", "propose_memories", "propose_blueprint", "propose_price", "cloudflare_login", "finish_task"],
      customTools: [
        createBashTool(this.options.loreHome, {
          operations: createSandboxedBashOperations(this.options.loreHome, task, this.options.binDir),
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
        this.#askTool(),
        this.#memoriesTool(),
        this.#blueprintTool(),
        this.#priceTool(),
        this.#cloudflareTool(),
        this.#finishTool()
      ]
    });
    session.subscribe((event) => {
      if (event.type === "tool_execution_start" && event.toolName !== "ask_user") {
        this.options.emit({ type: "live", task, text: event.toolName === "read" ? "Reading…" : "Looking through your Lore…" });
      }
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        const text = event.assistantMessageEvent.partial.content.map((block) => (block.type === "text" ? block.text : "")).join("");
        this.options.emit({ type: "live", task, text });
      }
      if (event.type === "tool_execution_end" && event.toolName === "bash") this.options.emit({ type: "changed" });
      if (event.type !== "message_end" || event.message.role !== "assistant") return;
      if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
        this.options.emit({ type: "message", task, text: this.#capped ? CAPPED : event.message.errorMessage || "Lore's model did not answer." });
        return;
      }
      if (++this.#turns >= MAX_TURNS && !this.#capped) {
        this.#capped = true;
        void session.abort();
      }
      const text = event.message.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("")
        .trim();
      if (text) this.options.emit({ type: "message", task, text });
    });
    this.#sessions.set(task, session);
    return [session, resumed];
  }

  /** Hold the running task at needs_you while the owner acts, then hand it back to the agent. @template T @param {string | undefined} phase @param {() => Promise<T>} act @param {string} [after] */
  async #attended(phase, act, after) {
    const task = this.#activeTask;
    const session = task && this.#sessions.get(task);
    if (task && session) this.#record(session, task, "needs_you", phase);
    try {
      return await act();
    } finally {
      if (task && session) this.#record(session, task, "working", after);
    }
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
      execute: async (_id, { questions }) => {
        const answers = await this.#attended(undefined, () => this.options.askUser(questions));
        return { content: [{ type: "text", text: JSON.stringify({ answers }) }], details: {} };
      }
    });
  }

  #memoriesTool() {
    const entry = Type.Object({
      title: Type.String({ minLength: 1, maxLength: 300 }),
      content: Type.String({ minLength: 1, maxLength: 20_000 }),
      project: Type.Optional(Type.String({ maxLength: 300 })),
      source_path: Type.Optional(Type.String({ maxLength: 2_000 }))
    });
    return defineTool({
      name: "propose_memories",
      label: "Propose memories",
      description: "Show one to five exact memory drafts for the owner to edit, keep, or drop. Keeping saves them privately and returns the saved memories; a correction returns the owner's words for you to revise and propose again.",
      parameters: Type.Object({ entries: Type.Array(entry, { minItems: 1, maxItems: 5 }) }),
      execute: async (_id, { entries }) => {
        const outcome = await this.#attended("Review the capture", () => this.options.proposeMemories(entries));
        return { content: [{ type: "text", text: JSON.stringify(outcome) }], details: {} };
      }
    });
  }

  #blueprintTool() {
    const fields = {
      version: Type.Literal(1),
      name: Type.String({ minLength: 1, maxLength: 200 }),
      persona: Type.Union(PERSONAS.map((persona) => Type.Literal(persona))),
      organizing_axis: Type.Optional(Type.Union(AXES.map((axis) => Type.Literal(axis)))),
      topic_outline: Type.Array(Type.String({ maxLength: 300 }), { minItems: 1, maxItems: 50 }),
      focus_topics: Type.Array(Type.String({ maxLength: 300 }), { maxItems: 50 }),
      general_areas: Type.Array(Type.String({ maxLength: 300 }), { maxItems: 50 }),
      storytelling: Type.String({ minLength: 1, maxLength: 1000 })
    };
    return defineTool({
      name: "propose_blueprint",
      label: "Propose the owner's Lore shape",
      description: "Show and save one evidence-backed Lore blueprint for the owner to edit. Call once during desktop onboarding.",
      parameters: Type.Object({ evidence: Type.String({ minLength: 1, maxLength: 240 }), ...fields }),
      execute: async (_id, { evidence, ...proposal }) => {
        if (!validBlueprint(proposal)) throw new Error("Invalid blueprint proposal");
        const edited = await this.#attended("Review your Lore shape", () => this.options.proposeBlueprint(/** @type {BlueprintFields} */ (proposal), evidence), "Lore shape saved");
        if (!validBlueprint(edited)) throw new Error("Invalid blueprint edits");
        return { content: [{ type: "text", text: JSON.stringify(edited) }], details: {} };
      }
    });
  }

  #priceTool() {
    return defineTool({
      name: "propose_price",
      label: "Propose a price",
      description: "Show the owner one suggested price per publication for them to confirm or change. Returns the amount they saved, or null if they declined. The only way to set a price in the app.",
      parameters: Type.Object({
        amount: Type.Number({ exclusiveMinimum: 0 }),
        reason: Type.String({ minLength: 1, maxLength: 240 })
      }),
      execute: async (_id, { amount, reason }) => {
        // No "saved" phase on the way out: the owner may decline, and the card
        // is the only thing that knows which happened.
        const saved = await this.#attended("Set your price", () => this.options.proposePrice(amount, reason));
        return { content: [{ type: "text", text: JSON.stringify({ price_usd: saved }) }], details: {} };
      }
    });
  }

  #cloudflareTool() {
    return defineTool({
      name: "cloudflare_login",
      label: "Sign in to Cloudflare",
      description: "Sign the owner in to Cloudflare through their browser. Call when wrangler says they are not authenticated; returns who is signed in, or that the owner declined for now.",
      parameters: Type.Object({}),
      execute: async () => {
        const text = await this.#attended("Sign in to Cloudflare", () => this.options.cloudflareLogin());
        return { content: [{ type: "text", text }], details: {} };
      }
    });
  }

  #finishTool() {
    return defineTool({
      name: "finish_task",
      label: "Finish the task",
      description: "Mark the current Lore task complete after its requested work succeeds.",
      parameters: Type.Object({}),
      execute: async () => {
        this.#completed = true;
        return { content: [{ type: "text", text: "Task complete" }], details: {} };
      }
    });
  }
}
