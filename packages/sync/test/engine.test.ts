import { expect, it, vi } from "vitest";
import { mergeOp, parseOp, type Op, type Replica } from "../../core/src/index";
import {
  MemoryAdapter,
  SyncEngine,
  type OpCodec,
  type SyncStore,
} from "../src/engine";

function device(adapter: MemoryAdapter, pending: Op[]) {
  let cursor = "0";
  let state: Replica = { fields: {} };
  let failAcknowledgement = false;
  const store: SyncStore = {
    async pending(limit) {
      return pending.slice(0, limit);
    },
    async acknowledge(ids) {
      if (failAcknowledgement) {
        failAcknowledgement = false;
        throw new Error("Interrupción");
      }
      pending = pending.filter((op) => !ids.includes(op.id));
    },
    async cursor() {
      return cursor;
    },
    async apply(ops, next) {
      state = ops.reduce(mergeOp, state);
      cursor = next;
    },
  };
  const codec: OpCodec = {
    async seal(op) {
      return JSON.stringify(op);
    },
    async open(change) {
      return parseOp(JSON.parse(change.ciphertext));
    },
  };
  return {
    engine: new SyncEngine(store, adapter, codec),
    snapshot: () => state,
    interrupt: () => {
      failAcknowledgement = true;
    },
  };
}

it("conserva la cola offline y converge tras un envío repetido y el alta de un tercer dispositivo", async () => {
  const adapter = new MemoryAdapter();
  const base = {
    v: 1,
    entity: "item",
    entityId: "item",
    hlc: "1:0",
    kind: "set",
  } as const;
  const a = device(adapter, [
    { ...base, id: "1", deviceId: "a", field: "title", value: "Tarea" },
  ]);
  const b = device(adapter, [
    { ...base, id: "2", deviceId: "b", field: "notes", value: "Nota" },
  ]);
  adapter.online = false;
  await expect(a.engine.sync()).rejects.toThrow("Sin conexión");
  adapter.online = true;
  a.interrupt();
  await expect(a.engine.sync()).rejects.toThrow("Interrupción");
  await Promise.all([a.engine.sync(), b.engine.sync()]);
  await Promise.all([a.engine.sync(), b.engine.sync()]);
  const c = device(adapter, []);
  await c.engine.sync();
  expect(a.snapshot()).toEqual(b.snapshot());
  expect(c.snapshot()).toEqual(a.snapshot());
  expect(await adapter.pull("0", 100)).toHaveLength(2);
});

it("notifica el fallo y luego confirma el primer ciclo correcto al reintentar", async () => {
  vi.useFakeTimers();
  const adapter = new MemoryAdapter();
  adapter.online = false;
  const reportError = vi.fn();
  const reportSuccess = vi.fn();
  const stop = device(adapter, []).engine.start(reportError, reportSuccess);
  try {
    await vi.advanceTimersByTimeAsync(0);
    expect(reportError).toHaveBeenCalledOnce();
    expect(reportSuccess).not.toHaveBeenCalled();

    adapter.online = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(reportSuccess).toHaveBeenCalledOnce();

    stop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(reportSuccess).toHaveBeenCalledOnce();
  } finally {
    stop();
    vi.useRealTimers();
  }
});
