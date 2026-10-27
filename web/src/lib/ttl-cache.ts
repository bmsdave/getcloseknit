/** A small in-process LRU whose entries also expire: least recently read first out past `capacity`. */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();

  constructor(private readonly capacity: number, private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  get size(): number {
    return this.entries.size;
  }

  /** The value, or undefined when absent or expired (a read makes it the most recent). */
  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    this.entries.delete(key);
    if (entry.expires <= this.now()) return undefined;
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expires: this.now() + this.ttlMs });
    for (const oldest of this.entries.keys()) {
      if (this.entries.size <= this.capacity) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
