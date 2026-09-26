/**
 * Priority task queue with limited concurrency and spacing between starts.
 * Tasks with the same key are coalesced; re-requesting raises the priority.
 */

interface Task {
  key: string;
  priority: number;
  run: () => Promise<void>;
}

export class TaskQueue {
  private readonly waiting = new Map<string, Task>();
  private readonly running = new Set<string>();
  private lastStart = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly concurrency = 2,
    private readonly spacingMs = 200,
  ) {}

  has(key: string): boolean {
    return this.waiting.has(key) || this.running.has(key);
  }

  add(key: string, priority: number, run: () => Promise<void>): void {
    if (this.running.has(key)) return;
    const existing = this.waiting.get(key);
    if (existing) {
      existing.priority = Math.max(existing.priority, priority);
      return;
    }
    this.waiting.set(key, { key, priority, run });
    this.pump();
  }

  private pump(): void {
    if (this.timer || this.running.size >= this.concurrency || this.waiting.size === 0) return;
    const wait = this.lastStart + this.spacingMs - Date.now();
    if (wait > 0) {
      this.timer = setTimeout(() => {
        this.timer = undefined;
        this.pump();
      }, wait);
      return;
    }
    let next: Task | undefined;
    for (const t of this.waiting.values()) if (!next || t.priority > next.priority) next = t;
    if (!next) return;
    this.waiting.delete(next.key);
    this.running.add(next.key);
    this.lastStart = Date.now();
    const done = next.key;
    next
      .run()
      .catch(() => undefined)
      .finally(() => {
        this.running.delete(done);
        this.pump();
      });
    this.pump();
  }
}
