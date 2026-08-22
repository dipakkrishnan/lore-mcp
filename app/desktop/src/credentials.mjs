import { chmod, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class CredentialStore {
  /** @type {Map<string, Promise<unknown>>} */
  #chains = new Map();

  /** @param {string} path @param {import("electron").SafeStorage} safeStorage */
  constructor(path, safeStorage) {
    this.path = path;
    this.safeStorage = safeStorage;
  }

  /** @returns {Promise<Record<string, import("@earendil-works/pi-ai").Credential>>} */
  async #load() {
    try {
      const encrypted = await readFile(this.path);
      return JSON.parse(this.safeStorage.decryptString(encrypted));
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return {};
      throw error;
    }
  }

  /** @param {Record<string, import("@earendil-works/pi-ai").Credential>} credentials */
  async #save(credentials) {
    if (!this.safeStorage.isEncryptionAvailable()) throw new Error("Keychain is unavailable");
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, this.safeStorage.encryptString(JSON.stringify(credentials)), {
      mode: 0o600
    });
    await rename(temporary, this.path);
    await chmod(this.path, 0o600);
  }

  /** @template T @param {string} providerId @param {() => Promise<T>} task @returns {Promise<T>} */
  #enqueue(providerId, task) {
    const previous = this.#chains.get(providerId) ?? Promise.resolve();
    const next = previous.then(task, task);
    this.#chains.set(providerId, next.catch(() => undefined));
    return next;
  }

  /** @param {string} providerId */
  async read(providerId) {
    return (await this.#load())[providerId];
  }

  async list() {
    return Object.entries(await this.#load()).map(([providerId, credential]) => ({
      providerId,
      type: credential.type
    }));
  }

  /**
   * @param {string} providerId
   * @param {(current: import("@earendil-works/pi-ai").Credential | undefined) => Promise<import("@earendil-works/pi-ai").Credential | undefined>} change
   */
  modify(providerId, change) {
    return this.#enqueue(providerId, async () => {
      const credentials = await this.#load();
      const next = await change(credentials[providerId]);
      if (next !== undefined) {
        credentials[providerId] = next;
        await this.#save(credentials);
      }
      return next ?? credentials[providerId];
    });
  }

  /** @param {string} providerId */
  delete(providerId) {
    return this.#enqueue(providerId, async () => {
      const credentials = await this.#load();
      delete credentials[providerId];
      await this.#save(credentials);
    });
  }
}
