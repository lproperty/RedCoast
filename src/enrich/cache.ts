/**
 * Small TTL cache backed by localStorage, so route/aircraft lookups survive reloads and
 * the free lookup services are asked about each flight only once a day or so.
 * Storage failures (private mode, quota) degrade to memory-only.
 */

interface Entry<T> {
  v: T | null;
  exp: number;
}

export class TtlCache<T> {
  private readonly mem = new Map<string, Entry<T>>();
  private writes = 0;

  constructor(
    private readonly namespace: string,
    private readonly maxEntries = 1500,
  ) {}

  private storageKey(key: string): string {
    return `rc.${this.namespace}.${key}`;
  }

  /** Cached value (null = known to have no data), or undefined when missing or expired. */
  get(key: string): T | null | undefined {
    const now = Date.now();
    let e = this.mem.get(key);
    if (!e) {
      try {
        const raw = localStorage.getItem(this.storageKey(key));
        if (raw) {
          e = JSON.parse(raw) as Entry<T>;
          this.mem.set(key, e);
        }
      } catch {
        /* storage unavailable */
      }
    }
    if (!e || e.exp < now) return undefined;
    return e.v;
  }

  set(key: string, value: T | null, ttlMs: number): void {
    const e: Entry<T> = { v: value, exp: Date.now() + ttlMs };
    this.mem.set(key, e);
    try {
      localStorage.setItem(this.storageKey(key), JSON.stringify(e));
      if (++this.writes % 50 === 0) this.trim();
    } catch {
      this.trim();
    }
  }

  /** Drops expired entries, then the soonest-to-expire ones beyond maxEntries. */
  private trim(): void {
    try {
      const prefix = `rc.${this.namespace}.`;
      const items: { k: string; exp: number }[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k?.startsWith(prefix)) continue;
        let exp = 0;
        try {
          exp = (JSON.parse(localStorage.getItem(k) ?? '{}') as Entry<T>).exp ?? 0;
        } catch {
          /* corrupt entry: remove */
        }
        items.push({ k, exp });
      }
      const now = Date.now();
      items.sort((a, b) => a.exp - b.exp);
      const excess = items.length - this.maxEntries;
      items.forEach((it, idx) => {
        if (it.exp < now || idx < excess) localStorage.removeItem(it.k);
      });
    } catch {
      /* storage unavailable */
    }
  }
}
