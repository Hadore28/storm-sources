import type { Cache } from "@storm-sources/sdk";

interface Entry {
  value: unknown;
  expires: number;
}

/** In-memory cache that drops the least recently used entries past `max`. */
export class MemoryCache implements Cache {
  private map = new Map<string, Entry>();

  constructor(private max = 5000) {}

  async get<T>(key: string): Promise<T | undefined> {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, e);
    return e.value as T;
  }

  async set(key: string, value: unknown, ttlMs: number) {
    this.map.delete(key);
    this.map.set(key, { value, expires: Date.now() + ttlMs });
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value!);
  }

  clear(prefix = "") {
    for (const k of [...this.map.keys()]) if (k.startsWith(prefix)) this.map.delete(k);
  }
}

/** A cache view whose keys all start with `prefix`, so sources can't collide. */
export function scoped(cache: Cache, prefix: string): Cache {
  return {
    get: (key) => cache.get(prefix + key),
    set: (key, value, ttl) => cache.set(prefix + key, value, ttl),
  };
}
