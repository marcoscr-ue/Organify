import { expect, it } from "vitest";
import { mergeOp, type Op, type Replica } from "../../core/src";
import { createOpCodec } from "../../crypto/src";
import {
  MemoryAdapter,
  SyncEngine,
  type SyncStore,
} from "../../sync/src/engine";
import { readEvent } from "../src/event-journal";
import { materialize, type JournalTables } from "../src/journal";

function device(adapter: MemoryAdapter, queue: Op[]) {
  const codec = createOpCodec("test", new Uint8Array(32));
  const replicas = new Map<string, Replica>();
  const tasks = new Map<string, { id: string; title: string }>();
  const tables = {
    items: {
      put: (task: { id: string; title: string }) => tasks.set(task.id, task),
    },
  } as unknown as JournalTables;
  let cursor = "0";
  const store: SyncStore = {
    async pending(limit) {
      return queue.slice(0, limit);
    },
    async acknowledge(ids) {
      queue = queue.filter((op) => !ids.includes(op.id));
    },
    async cursor() {
      return cursor;
    },
    async apply(ops, next) {
      for (const op of ops) {
        const key = `${op.entity}:${op.entityId}`;
        const state = mergeOp(replicas.get(key) ?? { fields: {} }, op);
        replicas.set(key, state);
        // parseOp, the codec and materialize use the same code as v0.14.0.
        await materialize(tables, op, state);
      }
      cursor = next;
    },
  };
  return { engine: new SyncEngine(store, adapter, codec), replicas, tasks };
}

const eventKey = "item:event/1";
const fields = (
  deviceId: string,
  entityId: string,
  values: Record<string, Extract<Op, { kind: "set" }>["value"]>,
): Op[] =>
  Object.entries(values).map(([field, value], index) => ({
    v: 1,
    id: `${deviceId}/${entityId}/${index}`,
    deviceId,
    entityId,
    entity: "item",
    hlc: `1:${index}`,
    kind: "set",
    field,
    value,
  }));

it.each(["0.14", "0.15"])(
  "conserva el evento y sincroniza tareas si %s se reconecta primero",
  async (first) => {
    const adapter = new MemoryAdapter();
    const task = { workspaceId: "test", order: "a0", status: "todo" };
    const old = device(
      adapter,
      fields("old", "task/old", { ...task, title: "Tarea 0.14" }),
    );
    const current = device(adapter, [
      ...fields("new", "task/new", { ...task, title: "Tarea 0.15" }),
      ...fields("new", "event/1", {
        "event:schedule": {
          timing: { allDay: true, start: "2026-11-25", end: "2026-11-26" },
          recurrence: { frequency: "weekly", interval: 1, until: null },
        },
        "event:title": "Clase",
      }),
    ]);
    adapter.online = false;
    await expect(old.engine.sync()).rejects.toThrow();
    await expect(current.engine.sync()).rejects.toThrow();
    adapter.online = true;
    const order = first === "0.14" ? [old, current] : [current, old];
    for (const client of [...order, ...order]) await client.engine.sync();
    expect(old.tasks).toEqual(current.tasks);
    expect(Array.from(old.tasks.keys()).sort()).toEqual([
      "task/new",
      "task/old",
    ]);
    const replica = old.replicas.get(eventKey);
    expect(replica).toBeDefined();
    // Updating the client reads the replica already saved at the current cursor.
    expect(readEvent(eventKey, replica!)).toMatchObject({
      id: "event/1",
      groupId: "event/1",
      title: "Clase",
      recurrence: { frequency: "weekly" },
    });
    expect(replica).toEqual(current.replicas.get(eventKey));
  },
);

it("mantiene un evento borrado al llegar una edición offline más reciente", () => {
  const edits = fields("new", "event/1", {
    "event:schedule": {
      timing: { allDay: true, start: "2026-11-25", end: "2026-11-26" },
      recurrence: null,
    },
    "event:removed": true,
    "event:title": "Cambio offline",
  });
  expect(
    readEvent(
      eventKey,
      edits.reverse().reduce<Replica>(mergeOp, { fields: {} }),
    ),
  ).toBeUndefined();
});
