import type { StateStore } from 'oidc-client-ts';

/** In-memory OIDC user store. Tokens never touch Web Storage. */
export class MemoryStateStore implements StateStore {
  private readonly data = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }

  async remove(key: string): Promise<string | null> {
    const previous = this.data.get(key) ?? null;
    this.data.delete(key);
    return previous;
  }

  async getAllKeys(): Promise<string[]> {
    return [...this.data.keys()];
  }

  clear(): void {
    this.data.clear();
  }

  /** Keys only — never return stored values to callers that might log. */
  leakingKeys(looksLikeToken: (value: string) => boolean): string[] {
    const keys: string[] = [];
    for (const [key, value] of this.data) {
      if (looksLikeToken(key) || looksLikeToken(value)) keys.push(key);
    }
    return keys;
  }
}
