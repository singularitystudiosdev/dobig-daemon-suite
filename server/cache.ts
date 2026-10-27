/** Tiny in-memory TTL cache that also de-duplicates concurrent loads of one key. */
export class TtlCache<V> {
  private store = new Map<string, { at: number; value: V }>()
  private inflight = new Map<string, Promise<V>>()

  private ttlMs: number
  private maxEntries: number

  constructor(ttlMs: number, maxEntries = 200) {
    this.ttlMs = ttlMs
    this.maxEntries = maxEntries
  }

  get(key: string): V | undefined {
    const hit = this.store.get(key)
    if (!hit) return undefined
    if (Date.now() - hit.at > this.ttlMs) {
      this.store.delete(key)
      return undefined
    }
    return hit.value
  }

  set(key: string, value: V): void {
    if (this.store.size >= this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest !== undefined) this.store.delete(oldest)
    }
    this.store.set(key, { at: Date.now(), value })
  }

  /** Returns the cached value, or runs `load` once even when called concurrently. */
  async wrap(key: string, load: () => Promise<V>): Promise<V> {
    const hit = this.get(key)
    if (hit !== undefined) return hit
    const running = this.inflight.get(key)
    if (running) return running
    const p = load()
      .then((v) => {
        this.set(key, v)
        return v
      })
      .finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }
}
