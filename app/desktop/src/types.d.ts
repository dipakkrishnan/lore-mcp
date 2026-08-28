type MemoryItem = {
  id: number;
  title: string;
  project_label: string;
  status: "private" | "discarded";
  updated_at: string;
};

type PublicationItem = {
  id: number;
  title: string;
  topic: string;
  state: "approved" | "revoked";
  live: boolean | null;
};

type Snapshot = {
  version: 1;
  home: string;
  setup: {
    sources_configured: boolean;
    blueprint_configured: boolean;
    profile_configured: boolean;
  };
  library: {
    counts: { private: number };
    sources: Array<{ name: string; label: string; enabled: boolean; imported: number }>;
    items: MemoryItem[];
  };
  publications: {
    counts: { active: number; revoked: number };
    items: PublicationItem[];
  };
  pricing: {
    publication_usd: number | null;
    answer_usd: number | null;
    answer_enabled: boolean;
  };
  node: {
    url: string | null;
    live: {
      state: "online" | "not_configured" | "unreachable";
      network: string | null;
    };
  };
};

type SearchHit = {
  id: string;
  title: string;
  project: string;
  content: string;
  status: string;
  updated_at: string;
};

declare const marked: { parse(source: string, options?: { async?: false }): string; use(options: { renderer?: Record<string, () => string> }): void };

type Memory = {
  id: number;
  title: string;
  content: string;
  project: string;
  source: string;
  status: string;
  updated_at: string;
};

type PublicationCandidate = {
  title: string;
  teaser: string;
  content: string;
  kind: "claim" | "content";
  topic: string;
  provenance: number[];
};

type AgentTask = "capture" | "setup" | "publish" | "deploy";
type TaskState = "needs_you" | "working" | "stopped" | "done";

type TaskRecord = {
  version: 1;
  kind: AgentTask;
  title: string;
  state: TaskState;
  phase: string;
  updatedAt: string;
};

type BlueprintFields = {
  version: 1;
  name: string;
  persona: "storyteller" | "schoolteacher" | "professor" | "executive" | "sage";
  organizing_axis?: "chronological" | "theme" | "project" | "knowledge";
  topic_outline: string[];
  focus_topics: string[];
  general_areas: string[];
  storytelling: string;
};

type Line = { text: string; owner: boolean; stopped?: boolean; action?: { label: string; run(): void } };

interface Window {
  lore: {
    snapshot(): Promise<Snapshot>;
    agentStatus(): Promise<AgentStatus>;
    prompt(input: { text: string; task: AgentTask }): Promise<void>;
    history(task: AgentTask): Promise<Line[]>;
    tasks(): Promise<TaskRecord[]>;
    restart(task: AgentTask): Promise<void>;
    respond(response: { id: string; value: unknown }): Promise<void>;
    login(input: { providerId: string; type: "oauth" | "api_key"; secret?: string }): Promise<AgentStatus>;
    logout(providerId: string): Promise<AgentStatus>;
    search(query: string): Promise<SearchHit[]>;
    memory(id: number): Promise<Memory>;
    candidates(): Promise<PublicationCandidate[]>;
    decide(input: { original: PublicationCandidate; candidate: PublicationCandidate; approve: boolean }): Promise<void>;
    revoke(id: number): Promise<void>;
    push(): Promise<void>;
    pickFiles(): Promise<string[]>;
    pathFor(file: File): string;
    onAgentEvent(listener: (event: AgentEvent) => void): () => void;
    startDictation(): Promise<void>;
    stopDictation(): Promise<void>;
    openDictationSettings(): Promise<void>;
    onDictation(listener: (event: DictationEvent) => void): () => void;
  };
}

type DictationEvent = { kind: "ready" | "partial" | "final" | "error" | "closed"; text: string };

type AgentStatus = {
  credentials: ReadonlyArray<{ providerId: string; type: "oauth" | "api_key" }>;
};

type OwnerQuestion = {
  question: string;
  header: string;
  options: Array<{ label: string; description: string }>;
  multiSelect: boolean;
};

type AuthPrompt =
  | { type: "text" | "secret" | "manual_code"; message: string; placeholder?: string }
  | {
      type: "select";
      message: string;
      options: ReadonlyArray<{ id: string; label: string; description?: string }>;
    };

type AgentRequest =
  | { type: "question"; id: string; questions: OwnerQuestion[] }
  | { type: "blueprint"; id: string; fields: BlueprintFields; evidence: string }
  | { type: "auth-prompt"; id: string; prompt: AuthPrompt }
  | { type: "cloudflare"; id: string };

type AgentEvent =
  | AgentRequest
  | { type: "dismiss"; id: string }
  | { type: "live"; text: string }
  | { type: "working"; active: boolean }
  | { type: "changed" }
  | { type: "message"; text: string }
  | { type: "stopped"; text: string }
  | { type: "task"; task: TaskRecord }
  | { type: "auth"; message?: string; event?: import("@earendil-works/pi-ai").AuthEvent }
  | { type: "progress"; text?: string; done?: boolean; error?: string };

type LoreAgentInstance = {
  status(): Promise<AgentStatus>;
  prompt(text: string, task: AgentTask): Promise<void>;
  history(task: AgentTask): Line[];
  tasks(): TaskRecord[];
  restart(task: AgentTask): void;
  login(providerId: string, type: "oauth" | "api_key", secret?: string): Promise<AgentStatus>;
  logout(providerId: string): Promise<AgentStatus>;
  dispose(): void;
};

type LoreAgentOptions = {
  loreHome: string;
  skillsDir: string;
  binDir?: string;
  credentials: import("@earendil-works/pi-ai").CredentialStore;
  emit(event: AgentEvent): void;
  askUser(questions: OwnerQuestion[]): Promise<Record<string, string>>;
  proposeBlueprint(fields: BlueprintFields, evidence: string): Promise<BlueprintFields>;
  cloudflareLogin(): Promise<string>;
  authPrompt(prompt: import("@earendil-works/pi-ai").AuthPrompt): Promise<string>;
  authEvent(event: import("@earendil-works/pi-ai").AuthEvent): void;
};
