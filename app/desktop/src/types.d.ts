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
  lore: { snapshot(): Promise<Snapshot> };
}
