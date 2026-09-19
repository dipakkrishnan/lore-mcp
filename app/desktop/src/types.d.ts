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
    // What the saved rhythm asks for and whether the scheduler holds it; null
    // with no profile. Optional: an installed CLI older than this app omits it.
    schedule?: { installed: boolean; executor: "claude" | "codex" | null; cadence: "daily" | "weekly" | null; hour: number | null } | null;
  };
  // Whether this build has a feedback relay pinned in. Optional: an
  // installed CLI older than this app omits it, and no relay is the safe
  // reading of its absence.
  feedback?: { available: boolean };
  // Whether this build can list the store on the public marketplace; same
  // relay, so absent means no (APP-119).
  marketplace?: { available: boolean };
  library: {
    counts: { private: number };
    sources: SourceEntry[];
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
  title: string;
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

/** Where a source stands, as its last read left it. */
type SourceState = "connected" | "nothing_found" | "needs_permission" | "unreachable" | "off";

/** One place memories come from. Everything past `imported` is STO-003's; an
 * installed CLI older than this app omits it, and the row renders the old way. */
type SourceEntry = {
  name: string;
  label: string;
  enabled: boolean;
  imported: number;
  kind?: "folder" | "export" | "feed";
  locator?: string;
  owned?: boolean;
  connector?: string | null;
  refresh?: boolean;
  state?: SourceState;
  last_read_at?: string | null;
};

/** One place an app offers to connect, found without asking the owner. */
type SourceChoice = { label: string; locator: string; open: boolean };

/** An app as the CLI's catalog offers it: what to call it, what Lore reads there, what the owner picks. */
type SourceApp = { id: string; name: string; what: string; unit: string; item: string; kind: "folder" | "export" | "feed"; refresh: boolean; placeholder: string };

type SourceRead = { name: string; added: number; updated: number; unchanged: number; errors: number; state: SourceState };

type SourceRemoval = { name: string; removed: boolean; memories: { kept: number; deleted?: number } };

type FeedbackReceipt = {
  url: string;
  number: number;
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
    prompt(input: { text: string; task: AgentTask; from?: AgentTask; memory?: number }): Promise<void>;
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
    schedule(): Promise<void>;
    setPrice(amount: number): Promise<void>;
    sales(): Promise<Sale[]>;
    reportFeedback(input: { title: string; email: string; description: string }): Promise<FeedbackReceipt>;
    listStore(action: "list" | "delist"): Promise<Listing>;
    listingStatus(): Promise<Listing>;
    pickFiles(): Promise<string[]>;
    pickFolder(): Promise<string | null>;
    sourceCatalog(): Promise<SourceApp[]>;
    sourceChoices(app: string): Promise<SourceChoice[]>;
    connectSource(input: { connector: string; locator: string; replace?: string }): Promise<SourceEntry>;
    readSource(name: string): Promise<SourceRead[]>;
    removeSource(name: string, keep: boolean): Promise<SourceRemoval>;
    openPrivacySettings(): Promise<void>;
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
  options: Array<{ label: string; description: string; recommended?: boolean }>;
  format?: "evm_address";
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
  prompt(text: string, task: AgentTask, from?: AgentTask, memory?: number): Promise<void>;
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
  /** How many staged drafts still wait on the owner's cards. */
  drafts?(): Promise<number>;
  authPrompt(prompt: import("@earendil-works/pi-ai").AuthPrompt): Promise<string>;
  authEvent(event: import("@earendil-works/pi-ai").AuthEvent): void;
  // Durable owner-run history. Injected rather than imported so the agent stays
  // free of the CLI bridge, and so tests can observe what a turn recorded.
  // Optional: history is a record of the work, never a precondition for it.
  job?: {
    start(kind: string): Promise<number | null>;
    finish(id: number, status: string, summary: string, title: string, costUsd: number | null): Promise<void>;
  };
};

/** Where a store stands on the public marketplace, as the relay reports it. */
interface Listing {
  ok: boolean;
  state: "none" | "pending" | "listed";
  action?: "list" | "delist";
  pull_url?: string;
  pull_number?: number;
}
