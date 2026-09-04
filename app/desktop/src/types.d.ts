type MemoryItem = {
  id: number;
  title: string;
  project_label: string;
  status: "private" | "discarded";
  updated_at: string;
};

type PublicationItem = {
  id: number;
  public_id: string;
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
      // What the node itself advertises, which is the price baked in at its
      // last deploy — not `pricing.publication_usd`, which is what the owner
      // last saved. Null when unreachable, or when the node predates the field.
      price_usd: number | null;
      payout: string | null;
    };
  };
  // Optional on purpose: an installed CLI older than this app has no `jobs` in
  // its snapshot, and Today must render without it rather than throw.
  jobs?: { items: JobItem[] };
};

type JobItem = {
  id: number;
  kind: "capture" | "synthesis" | "deploy" | "push";
  status: "running" | "succeeded" | "failed" | "incomplete";
  summary: string;
  count: number | null;
  cost_usd: number | null;
  started_at: string;
  finished_at: string | null;
};

/** One settled paid call, as the node's ledger records it. */
type Sale = {
  kind: "publication" | "answer";
  item_id: string;
  title: string;
  price_usd: number;
  network: string;
  payer: string;
  tx: string;
  sold_at: string;
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

type ProposedMemory = {
  title: string;
  content: string;
  project?: string;
  source_path?: string;
};

type SavedMemory = { id: number; status: string; title: string };

/** What the owner did with a memory card: the entries as edited, plus anything they said. */
type MemoryDecision = { entries: ProposedMemory[]; note?: string };

/** What the agent hears back: the memories Lore saved, or the owner's correction to revise. */
type MemoryOutcome = { saved: SavedMemory[] } | { entries: ProposedMemory[]; note: string };

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

type Line = { text: string; owner: boolean; stopped?: boolean; saved?: SavedMemory[] };

interface Window {
  lore: {
    snapshot(): Promise<Snapshot>;
    retrySetup(): Promise<void>;
    agentStatus(): Promise<AgentStatus>;
    prompt(input: { text: string; task: AgentTask; from?: AgentTask }): Promise<void>;
    history(task: AgentTask): Promise<Line[]>;
    tasks(): Promise<TaskRecord[]>;
    restart(task: AgentTask): Promise<void>;
    respond(response: { id: string; value: unknown }): Promise<void>;
    login(input: { providerId: string; type: "oauth" | "api_key"; secret?: string }): Promise<AgentStatus>;
    logout(providerId: string): Promise<AgentStatus>;
    search(query: string): Promise<SearchHit[]>;
    memory(id: number): Promise<Memory>;
    renameMemory(id: number, title: string): Promise<Memory>;
    editMemory(id: number, content: string): Promise<Memory>;
    candidates(): Promise<PublicationCandidate[]>;
    decide(input: { original: PublicationCandidate; candidate: PublicationCandidate; approve: boolean }): Promise<void>;
    revoke(id: number): Promise<void>;
    push(): Promise<void>;
    setPrice(amount: number): Promise<void>;
    sales(): Promise<Sale[]>;
    pickFiles(): Promise<string[]>;
    pathFor(file: File): string;
    onAgentEvent(listener: (event: AgentEvent) => void): () => void;
    microphone(): Promise<boolean>;
    transcribe(wav: ArrayBuffer): Promise<string>;
  };
}


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
  | { type: "question"; id: string; task: AgentTask | null; questions: OwnerQuestion[] }
  | { type: "memories"; id: string; task: AgentTask | null; entries: ProposedMemory[] }
  | { type: "blueprint"; id: string; task: AgentTask | null; fields: BlueprintFields; evidence: string }
  | { type: "auth-prompt"; id: string; task: AgentTask | null; prompt: AuthPrompt }
  | { type: "cloudflare"; id: string; task: AgentTask | null }
  | { type: "price"; id: string; task: AgentTask | null; amount: number; reason: string }
  | { type: "open"; id: string; task: AgentTask | null; title: string; url: string; note: string };

type AgentEvent =
  | AgentRequest
  | { type: "dismiss"; id: string }
  | { type: "live"; task: AgentTask | null; text: string }
  | { type: "working"; active: boolean; task: AgentTask }
  | { type: "changed" }
  | { type: "message"; task: AgentTask | null; text: string }
  | { type: "saved"; task: AgentTask | null; memories: SavedMemory[] }
  | { type: "stopped"; text: string }
  | { type: "task"; task: TaskRecord }
  | { type: "auth"; message?: string; event?: import("@earendil-works/pi-ai").AuthEvent }
  | { type: "progress"; text?: string; done?: boolean; error?: string };

type LoreAgentInstance = {
  readonly activeTask: AgentTask | null;
  status(): Promise<AgentStatus>;
  prompt(text: string, task: AgentTask, from?: AgentTask): Promise<void>;
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
  proposeMemories(entries: ProposedMemory[]): Promise<MemoryOutcome>;
  proposeBlueprint(fields: BlueprintFields, evidence: string): Promise<BlueprintFields>;
  /** Resolves to the amount the owner confirmed, or null if they declined. */
  proposePrice(amount: number, reason: string): Promise<number | null>;
  cloudflareLogin(): Promise<string>;
  openUrl(page: { title: string; url: string; note: string }): Promise<string>;
  storeSecret(name: "CDP_API_KEY_ID" | "CDP_API_KEY_SECRET"): Promise<string>;
  authPrompt(prompt: import("@earendil-works/pi-ai").AuthPrompt): Promise<string>;
  authEvent(event: import("@earendil-works/pi-ai").AuthEvent): void;
  // Durable owner-run history. Injected rather than imported so the agent stays
  // free of the CLI bridge, and so tests can observe what a turn recorded.
  // Optional: history is a record of the work, never a precondition for it.
  job?: {
    start(kind: string): Promise<number | null>;
    finish(id: number, status: string, summary: string, costUsd: number | null): Promise<void>;
  };
};
