import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
import {
  Agent,
  formatSkillInvocation,
  formatSkillsForSystemPrompt,
  loadSkills,
  type AgentTool,
  type Skill,
  type StreamFn
} from "@earendil-works/pi-agent-core";
import { NodeExecutionEnv } from "@earendil-works/pi-agent-core/node";
import {
  createModels,
  Type,
  type CredentialStore,
  type Models
} from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

const run = promisify(execFile);

export interface OwnerQuestion {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface OwnerChannel {
  ask(questions: OwnerQuestion[]): Promise<Record<string, string>>;
}

interface KernelOptions {
  loreHome: string;
  skillsDir: string;
  credentials: CredentialStore;
  owner: OwnerChannel;
}

export class LoreKernel {
  // Approval subcommands are deliberately absent: approvals stay app-invoked.
  private static allowed: ReadonlyMap<string, readonly string[] | null> = new Map([
    ["status", null],
    ["setup", null],
    ["sync", null],
    ["search", null],
    ["help", null],
    ["price", null],
    ["profile", null],
    ["capture", ["apply"]],
    ["blueprint", ["apply", "show"]],
    ["publication", ["list"]],
    ["push", null],
    ["node", ["deploy"]]
  ]);

  readonly models: Models;
  private constructor(
    models: Models,
    private env: NodeExecutionEnv,
    private skills: Skill[],
    private options: KernelOptions
  ) {
    this.models = models;
  }

  static async create(options: KernelOptions): Promise<LoreKernel> {
    const models = createModels({ credentials: options.credentials });
    models.setProvider(anthropicProvider());
    models.setProvider(openaiCodexProvider());
    const env = new NodeExecutionEnv({ cwd: options.loreHome });
    const { skills, diagnostics } = await loadSkills(env, options.skillsDir);
    for (const d of diagnostics) console.warn(`skill warning: ${d.path}: ${d.message}`);
    return new LoreKernel(models, env, skills, options);
  }

  skill(name: string): Skill {
    const skill = this.skills.find((s) => s.name === name);
    if (!skill) throw new Error(`unknown skill '${name}'; have: ${this.skills.map((s) => s.name).join(", ")}`);
    return skill;
  }

  invocation(name: string): string {
    return formatSkillInvocation(this.skill(name));
  }

  async agent(preferredModel?: string): Promise<Agent> {
    const available = await this.models.getAvailable();
    const model = available.find(({ id }) => id === preferredModel) ?? available.at(0);
    if (!model) throw new Error("no configured provider; run `npm run auth` or export ANTHROPIC_API_KEY");
    const streamFn: StreamFn = (m, context, streamOptions) =>
      this.models.streamSimple(m, context, { ...streamOptions, maxTokens: 4096 });
    return new Agent({
      streamFn,
      toolExecution: "sequential",
      initialState: { systemPrompt: this.systemPrompt(), model, tools: this.tools() }
    });
  }

  private systemPrompt(): string {
    return (
      "You are the Lore desktop app's embedded agent. The owner talks to you in a chat " +
      "panel; you have exactly three tools and no shell. Skills are your workflows: read " +
      "one with read_file when its description matches, and follow it as your " +
      "instructions, including when a skill routes to another skill. Skip any step that " +
      "installs Lore — the runtime is already provisioned. Use ask_user for structured " +
      "decisions and plain chat for open conversation. Approvals happen outside your " +
      "tools: present the content and tell the owner the app will show an approval card.\n\n" +
      formatSkillsForSystemPrompt(this.skills)
    );
  }

  private tools(): AgentTool<any>[] {
    return [this.cliTool(), this.readTool(), this.askTool()];
  }

  private result(text: string) {
    return { content: [{ type: "text" as const, text }], details: {} };
  }

  private rejectArgv(argv: readonly string[]): string | undefined {
    const subcommands = LoreKernel.allowed.get(argv[0] ?? "");
    if (subcommands === undefined) return `'lore ${argv[0] ?? ""}' is not on the desktop allowlist`;
    if (subcommands && !subcommands.includes(argv[1] ?? "")) {
      return `'lore ${argv.slice(0, 2).join(" ")}' is not on the desktop allowlist`;
    }
    return undefined;
  }

  private cliTool(): AgentTool<any> {
    const parameters = Type.Object(
      { argv: Type.Array(Type.String(), { minItems: 1 }) },
      { additionalProperties: false }
    );
    const allowed = [...LoreKernel.allowed.entries()]
      .map(([command, subs]) => (subs ? `${command} ${subs.join("|")}` : command))
      .join(", ");
    const tool: AgentTool<typeof parameters> = {
      name: "lore_cli",
      label: "Run lore",
      description: `Run the lore CLI with an argv array (no shell). Allowed: ${allowed}. Approval commands are owner-only and unavailable.`,
      parameters,
      execute: async (_callId, { argv }) => {
        const rejection = this.rejectArgv(argv);
        if (rejection) return this.result(`refused: ${rejection}`);
        try {
          const { stdout, stderr } = await run("lore", argv, {
            env: { ...process.env, LORE_HOME: this.options.loreHome, NO_COLOR: "1" },
            timeout: 120_000,
            maxBuffer: 4 * 1024 * 1024
          });
          return this.result((stdout + (stderr ? `\n${stderr}` : "")).trim() || "(no output)");
        } catch (error: any) {
          return this.result(`lore exited ${error.code ?? "?"}: ${String(error.stderr || error.message).slice(0, 2000)}`);
        }
      }
    };
    return tool;
  }

  private readTool(): AgentTool<any> {
    const roots = [
      resolve(homedir(), ".claude"),
      resolve(homedir(), ".codex"),
      resolve(homedir(), ".agents"),
      resolve(this.options.loreHome),
      resolve(this.options.skillsDir)
    ];
    const parameters = Type.Object({ path: Type.String() }, { additionalProperties: false });
    const tool: AgentTool<typeof parameters> = {
      name: "read_file",
      label: "Read file",
      description:
        "Read one file from the owner's agent-history directories (~/.claude, ~/.codex, ~/.agents), the Lore home, or the skills directory. Other paths are refused.",
      parameters,
      execute: async (_callId, { path }) => {
        let real: string;
        try {
          real = realpathSync(resolve(path.replace(/^~/, homedir())));
        } catch {
          return this.result(`refused: cannot resolve ${path}`);
        }
        if (!roots.some((root) => real === root || real.startsWith(root + "/"))) {
          return this.result(`refused: ${path} is outside the scoped roots`);
        }
        const body = await this.env.readTextFile(real);
        if (!body.ok) return this.result(`read failed: ${body.error.message}`);
        const text = body.value;
        return this.result(text.length > 100_000 ? text.slice(0, 100_000) + "\n…(truncated)" : text);
      }
    };
    return tool;
  }

  private askTool(): AgentTool<any> {
    const parameters = Type.Object(
      {
        questions: Type.Array(
          Type.Object(
            {
              question: Type.String(),
              header: Type.String(),
              options: Type.Array(
                Type.Object(
                  { label: Type.String(), description: Type.String() },
                  { additionalProperties: false }
                )
              ),
              multiSelect: Type.Boolean()
            },
            { additionalProperties: false }
          ),
          { minItems: 1, maxItems: 4 }
        )
      },
      { additionalProperties: false }
    );
    const tool: AgentTool<typeof parameters> = {
      name: "ask_user",
      label: "Ask the owner",
      description:
        "Ask the owner up to 4 structured questions. Each returns the selected option label(s) or free text. Use for decisions, not for confirmation of every step.",
      parameters,
      execute: async (_callId, { questions }) =>
        this.result(JSON.stringify({ answers: await this.options.owner.ask(questions) }))
    };
    return tool;
  }
}
