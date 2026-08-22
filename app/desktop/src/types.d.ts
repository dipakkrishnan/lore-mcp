type MemoryItem = {
  id: number;
  title: string;
  project: string;
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
  setup: {
    sources_configured: boolean;
    blueprint_configured: boolean;
    profile_configured: boolean;
  };
  library: {
    counts: { private: number; discarded: number };
    sources: Array<{
      name: string;
      label: string;
      enabled: boolean;
      imported: number;
    }>;
    items: MemoryItem[];
  };
  publications: {
    counts: {
      active: number;
      needs_review: number;
      revoked: number;
      live: number | null;
      approved_not_live: number | null;
      drafts: null;
    };
    drafts_available: false;
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

interface Window {
  lore: {
    snapshot(): Promise<Snapshot>;
    agentStatus(): Promise<AgentStatus>;
    prompt(text: string): Promise<void>;
    respond(response: { id: string; value: unknown }): Promise<void>;
    login(input: {
      providerId: string;
      type: "oauth" | "api_key";
      secret?: string;
    }): Promise<AgentStatus>;
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
  | { type: "bash-approval"; id: string; command: string }
  | { type: "question"; id: string; questions: OwnerQuestion[] }
  | { type: "auth-prompt"; id: string; prompt: AuthPrompt };

type AgentEvent =
  | AgentRequest
  | { type: "working"; active: boolean }
  | { type: "tool"; name: string; active: boolean; failed?: boolean }
  | { type: "message"; text: string }
  | { type: "auth"; message?: string; event?: import("@earendil-works/pi-ai").AuthEvent };

type LoreAgentInstance = {
  status(): Promise<AgentStatus>;
  prompt(text: string): Promise<void>;
  login(providerId: string, type: "oauth" | "api_key", secret?: string): Promise<AgentStatus>;
  dispose(): void;
};

type LoreAgentOptions = {
  loreHome: string;
  skillsDir: string;
  credentials: import("@earendil-works/pi-ai").CredentialStore;
  emit(event: AgentEvent): void;
  approveBash(command: string): Promise<boolean>;
  askUser(questions: OwnerQuestion[]): Promise<Record<string, string>>;
  authPrompt(prompt: import("@earendil-works/pi-ai").AuthPrompt): Promise<string>;
  authEvent(event: import("@earendil-works/pi-ai").AuthEvent): void;
};
