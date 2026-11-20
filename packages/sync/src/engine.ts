import type { Op } from "@organify/core";

export interface Change {
  opId: string;
  deviceId: string;
  ciphertext: string;
}
export interface Entry extends Change {
  cursor: string;
}
export interface SyncAdapter {
  push(changes: Change[]): Promise<void>;
  pull(cursor: string, limit: number): Promise<Entry[]>;
  subscribe(wake: () => void): () => void;
}
export interface SyncStore {
  pending(limit: number): Promise<Op[]>;
  acknowledge(ids: string[]): Promise<void>;
  cursor(): Promise<string>;
  apply(ops: Op[], cursor: string): Promise<void>;
}
export interface OpCodec {
  seal(op: Op): Promise<string>;
  open(change: Change): Promise<Op>;
}

export class SyncEngine {
  private running?: Promise<void>;
  constructor(
    private readonly store: SyncStore,
    private readonly adapter: SyncAdapter,
    private readonly codec: OpCodec,
  ) {}

  sync(): Promise<void> {
    this.running ??= this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  start(
    reportError: (error: unknown) => void,
    reportSuccess?: () => void,
  ): () => void {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let delay = 1000;
    let active = false;
    const wake = async () => {
      if (stopped || active) return;
      clearTimeout(timer);
      active = true;
      try {
        await this.sync();
        delay = 1000;
        if (!stopped) reportSuccess?.();
      } catch (error) {
        delay = Math.min(delay * 2, 60_000);
        if (!stopped) reportError(error);
      } finally {
        active = false;
        if (!stopped) timer = setTimeout(wake, delay);
      }
    };
    const unsubscribe = this.adapter.subscribe(() => {
      void wake();
    });
    void wake();
    return () => {
      if (stopped) return;
      stopped = true;
      clearTimeout(timer);
      unsubscribe();
    };
  }

  private async run(): Promise<void> {
    const limit = 100;
    for (;;) {
      const ops = await this.store.pending(limit);
      if (!ops.length) break;
      await this.adapter.push(
        await Promise.all(
          ops.map(async (op) => ({
            opId: op.id,
            deviceId: op.deviceId,
            ciphertext: await this.codec.seal(op),
          })),
        ),
      );
      await this.store.acknowledge(ops.map((op) => op.id));
    }

    let cursor = await this.store.cursor();
    for (;;) {
      const entries = await this.adapter.pull(cursor, limit);
      if (!entries.length) break;
      const operations = await Promise.all(
        entries.map((entry) => this.codec.open(entry)),
      );
      cursor = entries[entries.length - 1].cursor;
      await this.store.apply(operations, cursor);
      if (entries.length < limit) break;
    }
  }
}

export class MemoryAdapter implements SyncAdapter {
  private readonly entries = new Map<string, Entry>();
  private readonly listeners = new Set<() => void>();
  online = true;

  async push(changes: Change[]): Promise<void> {
    if (!this.online) throw new Error("Sin conexión");
    for (const change of changes) {
      if (!this.entries.has(change.opId)) {
        this.entries.set(change.opId, {
          ...change,
          cursor: String(this.entries.size + 1),
        });
      }
    }
    for (const wake of this.listeners) wake();
  }

  async pull(cursor: string, limit: number): Promise<Entry[]> {
    if (!this.online) throw new Error("Sin conexión");
    return Array.from(this.entries.values()).slice(
      Number(cursor),
      Number(cursor) + limit,
    );
  }

  subscribe(wake: () => void): () => void {
    this.listeners.add(wake);
    return () => this.listeners.delete(wake);
  }
}
