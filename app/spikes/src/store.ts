import { mkdirSync, readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AuthOperationOptions,
  Credential,
  CredentialInfo,
  CredentialStore
} from "@earendil-works/pi-ai";

/**
 * File-backed CredentialStore for terminal spikes. The desktop app replaces
 * the read/write primitives with Electron safeStorage over the same
 * interface; everything else (per-provider serialization, refresh inside
 * modify) is identical, which is the point of the spike.
 */
export class FileCredentialStore implements CredentialStore {
  private chains = new Map<string, Promise<unknown>>();

  constructor(private path: string) {}

  private load(): Record<string, Credential> {
    if (!existsSync(this.path)) return {};
    return JSON.parse(readFileSync(this.path, "utf8"));
  }

  private save(all: Record<string, Credential>): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(all, null, 2));
    chmodSync(this.path, 0o600);
  }

  private enqueue<T>(providerId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.chains.get(providerId) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.chains.set(providerId, next.catch(() => undefined));
    return next;
  }

  async read(providerId: string, _options?: AuthOperationOptions): Promise<Credential | undefined> {
    return this.load()[providerId];
  }

  async list(_options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    return Object.entries(this.load()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type
    }));
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    _options?: AuthOperationOptions
  ): Promise<Credential | undefined> {
    return this.enqueue(providerId, async () => {
      const all = this.load();
      const next = await fn(all[providerId]);
      if (next !== undefined) {
        all[providerId] = next;
        this.save(all);
      }
      return next ?? all[providerId];
    });
  }

  delete(providerId: string, _options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(providerId, async () => {
      const all = this.load();
      delete all[providerId];
      this.save(all);
    });
  }
}
