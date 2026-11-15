import type { Table } from "dexie";
import { v7 } from "uuid";
import {
  mergeOp,
  replicaDeletedAt,
  tickHlc,
  statuses,
  type Item,
  type Project,
  type Json,
  type Op,
  type Replica,
} from "@organify/core";

export interface JournalTables {
  items: Table<Item, string>;
  projects: Table<Project, string>;
  settings: Table<{ key: string; value: string }, string>;
  replicas: Table<{ key: string; state: Replica }, string>;
  outbox: Table<Op, string>;
}

function key(op: Op) {
  return op.entity + ":" + op.entityId;
}

export async function mergeReplica(db: JournalTables, op: Op) {
  const row = await db.replicas.get(key(op));
  const state = mergeOp(row?.state ?? { fields: {} }, op);
  await db.replicas.put({ key: key(op), state });
  return state;
}

export async function record(
  db: JournalTables,
  entity: Op["entity"],
  next: Item | Project,
  previous?: Item | Project,
) {
  let deviceId = (await db.settings.get("device"))?.value;
  if (!deviceId) {
    deviceId = v7();
    await db.settings.put({ key: "device", value: deviceId });
  }
  let clock = (await db.settings.get("clock"))?.value;
  const ops: Op[] = [];
  const base = () => {
    clock = tickHlc(Date.now(), clock);
    return {
      v: 1 as const,
      id: v7(),
      deviceId,
      hlc: clock,
      entity,
      entityId: next.id,
    };
  };
  if (!next.deletedAt || !previous) {
    const oldFields = new Map(Object.entries(previous ?? {}));
    for (const [field, value] of Object.entries(next)) {
      if (
        field === "id" ||
        field === "deletedAt" ||
        (previous && Object.is(oldFields.get(field), value))
      )
        continue;
      ops.push({
        ...base(),
        kind: "set",
        field,
        value: (value ?? null) as Json,
      });
    }
  }
  if (next.deletedAt && next.deletedAt !== previous?.deletedAt)
    ops.push({ ...base(), kind: "delete" });
  if (!ops.length || !clock) return;
  for (const op of ops) await mergeReplica(db, op);
  await db.outbox.bulkAdd(ops);
  await db.settings.put({ key: "clock", value: clock });
}

export async function materialize(db: JournalTables, op: Op, state: Replica) {
  const field = (name: string) => state.fields[name]?.value;
  const string = (name: string) => {
    const value = field(name);
    return typeof value === "string" ? value : undefined;
  };
  const workspaceId = string("workspaceId");
  const order = string("order");
  const deletedAt = replicaDeletedAt(state);
  if (!workspaceId || !order) return;

  if (op.entity === "project") {
    const name = string("name");
    if (name)
      await db.projects.put({
        id: op.entityId,
        workspaceId,
        order,
        name,
        archived: field("archived") === true,
        deletedAt,
      });
    return;
  }
  const title = string("title");
  const status = statuses.find((value) => value === field("status"));
  if (!title || !status) return;
  const props = field("props");
  const tags = field("tagIds");
  const allDay = field("allDay");
  await db.items.put({
    id: op.entityId,
    workspaceId,
    order,
    title,
    status,
    deletedAt,
    notes: string("notes") ?? "",
    start: string("start"),
    due: string("due"),
    projectId: string("projectId"),
    recurrence: string("recurrence"),
    allDay: typeof allDay === "boolean" ? allDay : undefined,
    tagIds: Array.isArray(tags)
      ? tags.filter((tag): tag is string => typeof tag === "string")
      : [],
    props:
      props && typeof props === "object" && !Array.isArray(props) ? props : {},
  });
}
