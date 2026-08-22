import { resolve } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type Skill
} from "@earendil-works/pi-coding-agent";
import { Type, type CredentialStore } from "@earendil-works/pi-ai";

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
  readonly models: ModelRuntime;
  private constructor(
    models: ModelRuntime,
    private resources: DefaultResourceLoader,
    private settings: SettingsManager,
    private options: KernelOptions
  ) {
    this.models = models;
  }

  static async create(options: KernelOptions): Promise<LoreKernel> {
    process.env.LORE_HOME = options.loreHome;
    process.env.NO_COLOR = "1";
    const models = await ModelRuntime.create({ credentials: options.credentials });
    const settings = SettingsManager.inMemory();
    const resources = new DefaultResourceLoader({
      cwd: options.loreHome,
      agentDir: resolve(options.loreHome, ".pi"),
      settingsManager: settings,
      additionalSkillPaths: [options.skillsDir],
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: LoreKernel.systemPrompt()
    });
    await resources.reload();
    return new LoreKernel(models, resources, settings, options);
  }

  skill(name: string): Skill {
    const skills = this.resources.getSkills().skills;
    const skill = skills.find((candidate) => candidate.name === name);
    if (!skill) throw new Error(`unknown skill '${name}'; have: ${skills.map((s) => s.name).join(", ")}`);
    return skill;
  }

  invocation(name: string): string {
    return `/skill:${this.skill(name).name}`;
  }

  async session(preferredModel?: string): Promise<AgentSession> {
    const available = await this.models.getAvailable();
    const model = available.find(({ id }) => id === preferredModel) ?? available.at(0);
    if (!model) throw new Error("no configured provider; run `npm run auth` or export ANTHROPIC_API_KEY");
    const { session } = await createAgentSession({
      cwd: this.options.loreHome,
      agentDir: resolve(this.options.loreHome, ".pi"),
      modelRuntime: this.models,
      model,
      resourceLoader: this.resources,
      settingsManager: this.settings,
      sessionManager: SessionManager.inMemory(this.options.loreHome),
      tools: ["read", "bash", "ask_user"],
      customTools: [this.askTool()]
    });
    return session;
  }

  private static systemPrompt(): string {
    return [
      "You are the Lore desktop app's embedded agent.",
      "Lore skills are your workflows. Read and follow the matching skill, including its handoffs.",
      "Use bash only for the active Lore workflow and prefer lore CLI commands.",
      "Skip installation steps because the desktop app already provisioned Lore.",
      "Use ask_user for structured decisions and plain chat for open conversation; ask_user is this runtime's equivalent of Claude Code's AskUserQuestion.",
      "Never run attended approval commands; present the content and let the app show its approval UI."
    ].join(" ");
  }

  private result(text: string) {
    return { content: [{ type: "text" as const, text }], details: {} };
  }

  private askTool() {
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
    return defineTool({
      name: "ask_user",
      label: "Ask the owner",
      description:
        "Ask the owner up to 4 structured questions. Each returns the selected option label(s) or free text. Use for decisions, not for confirmation of every step.",
      parameters,
      execute: async (_callId, { questions }) =>
        this.result(JSON.stringify({ answers: await this.options.owner.ask(questions) }))
    });
  }
}
