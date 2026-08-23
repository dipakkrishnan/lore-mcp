type MemoryItem = {
  id: number;
  title: string;
  project: string;
  project_label: string;
  status: "private" | "discarded";
  source: string;
  updated_at: string;
};

type PublicationItem = {
  id: number;
  public_id: string;
  title: string;
  kind: "claim" | "content";
  topic: string;
  updated_at: string;
  source_changed_at: string | null;
  state: "approved" | "revoked";
  needs_review: boolean;
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
    counts: { private: number; discarded: number };
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
    staged: boolean;
    revocation_pending: boolean;
    live: {
      state: "online" | "not_configured" | "unreachable";
      publication_count: number | null;
      publication_price_usd: number | null;
      answer_price_usd: number | null;
      network: string | null;
      error?: string;
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

type Memory = {
  id: number;
  title: string;
  content: string;
  project: string;
  source: string;
  status: string;
  updated_at: string;
};

type CaptureEntry = { title: string; content: string; project?: string; source_path?: string };

type PublicationCandidate = {
  title: string;
  teaser: string;
  content: string;
  kind: "claim" | "content";
  topic: string;
  provenance: number[];
};

type BashAction =
  | { kind: "import" }
  | { kind: "capture"; entries: CaptureEntry[] }
  | { kind: "blueprint" | "profile"; fields: Record<string, unknown> };

type AgentTask = "capture" | "setup" | "publish";

interface Window {
  lore: {
    snapshot(): Promise<Snapshot>;
    agentStatus(): Promise<AgentStatus>;
    prompt(input: { text: string; task: AgentTask }): Promise<void>;
    respond(response: { id: string; value: unknown }): Promise<void>;
    login(input: { providerId: string; type: "oauth" | "api_key"; secret?: string }): Promise<AgentStatus>;
    logout(providerId: string): Promise<AgentStatus>;
    search(query: string): Promise<SearchHit[]>;
    memory(id: number): Promise<Memory>;
    candidates(): Promise<PublicationCandidate[]>;
    decide(input: { candidate: PublicationCandidate; approve: boolean }): Promise<void>;
    reapprove(id: number): Promise<void>;
    revoke(id: number): Promise<void>;
    push(): Promise<void>;
    pickFiles(): Promise<string[]>;
    pathFor(file: File): string;
    onAgentEvent(listener: (event: AgentEvent) => void): () => void;
  };
}

type AgentStatus = {
  credentials: ReadonlyArray<{ providerId: string; type: "oauth" | "api_key" }>;
  busy: boolean;
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
  | { type: "bash-approval"; id: string; command: string; action: BashAction }
  | { type: "question"; id: string; questions: OwnerQuestion[] }
  | { type: "auth-prompt"; id: string; prompt: AuthPrompt };

type AgentEvent =
  | AgentRequest
  | { type: "working"; active: boolean }
  | { type: "changed" }
  | { type: "message"; text: string }
  | { type: "auth"; message?: string; event?: import("@earendil-works/pi-ai").AuthEvent }
  | { type: "progress"; text?: string; done?: boolean; error?: string };

type LoreAgentInstance = {
  status(): Promise<AgentStatus>;
  prompt(text: string, task: AgentTask): Promise<void>;
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
  approveBash(command: string, action: BashAction): Promise<boolean>;
  askUser(questions: OwnerQuestion[]): Promise<Record<string, string>>;
  authPrompt(prompt: import("@earendil-works/pi-ai").AuthPrompt): Promise<string>;
  authEvent(event: import("@earendil-works/pi-ai").AuthEvent): void;
};
