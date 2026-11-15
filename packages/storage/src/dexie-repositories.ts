import * as Y from "yjs";
import Dexie, { liveQuery, type Table } from "dexie";
import { generateKeyBetween } from "fractional-indexing";
import { v7 } from "uuid";
import type { Id, Item, Project, Op, Replica } from "@organify/core";
import { tickHlc } from "@organify/core";
import {
  documentPrefix,
  materialize,
  mergeReplica,
  propertyPrefix,
  record,
  recordField,
} from "./journal";
import type { SavedView, TaskRepositories } from "./index";

class OrganifyDatabase extends Dexie {
  declare items: Table<Item, Id>;
  declare projects: Table<Project, Id>;
  declare settings: Table<{ key: string; value: Id }, string>;
  declare replicas: Table<{ key: string; state: Replica }, string>;
  declare outbox: Table<Op, string>;

  declare documents: Table<{ id: Id; state: Uint8Array }, Id>;
  declare views: Table<SavedView, Id>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      items: "id, [status+order]",
      projects: "id, order",
      settings: "key",
    });
    this.version(2)
      .stores({ replicas: "key", outbox: "id" })
      .upgrade(async (tx) => {
        const tables = {
          items: tx.table<Item, Id>("items"),
          projects: tx.table<Project, Id>("projects"),
          settings: tx.table<{ key: string; value: string }, string>(
            "settings",
          ),
          replicas: tx.table<{ key: string; state: Replica }, string>(
            "replicas",
          ),
          outbox: tx.table<Op, string>("outbox"),
        };
        for (const project of await tables.projects.toArray())
          await record(tables, "project", project);
        for (const item of await tables.items.toArray())
          await record(tables, "item", item);
      });
    this.version(3).stores({ documents: "id", views: "id" });
  }
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

export function createTaskRepositories(name = "organify"): TaskRepositories {
  const db = new OrganifyDatabase(name);

  async function workspaceId(): Promise<Id> {
    const account = await db.settings.get("account");
    if (account) return account.value;
    const existing = await db.settings.get("workspace");
    if (existing) return existing.value;
    const value = v7();
    await db.settings.add({ key: "workspace", value });
    return value;
  }

  async function checkProject(id: Id | undefined): Promise<void> {
    if (!id) return;
    const project = await db.projects.get(id);
    if (!project || project.deletedAt || project.archived) {
      throw new Error("El proyecto ya no está disponible.");
    }
  }

  async function getItem(id: Id): Promise<Item> {
    const item = await db.items.get(id);
    if (!item || item.deletedAt)
      throw new Error("La tarea ya no está disponible.");
    return item;
  }

  async function nextOrder(status: Item["status"]): Promise<string> {
    const last = await db.items
      .where("[status+order]")
      .between([status, Dexie.minKey], [status, Dexie.maxKey])
      .last();
    return generateKeyBetween(last?.order ?? null, null);
  }

  const writeTables = [
    db.items,
    db.projects,
    db.settings,
    db.replicas,
    db.outbox,
    db.documents,
  ];
  async function applyDocument(id: Id, encoded: string) {
    const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
    const existing = await db.documents.get(id);
    const state = Y.mergeUpdates(existing ? [existing.state, bytes] : [bytes]);
    await db.documents.put({ id, state });
  }

  return {
    documents: {
      subscribe(id, next, error) {
        const listener = liveQuery(
          async () => (await db.documents.get(id))?.state,
        ).subscribe({ next, error });
        return () => listener.unsubscribe();
      },
      append(id, update) {
        return db.transaction("rw", writeTables, async () => {
          await getItem(id);
          const encoded = btoa(
            Array.from(update, (byte) => String.fromCharCode(byte)).join(""),
          );
          await applyDocument(id, encoded);
          // A unique field lets existing clients consume the same operation format.
          await recordField(db, id, documentPrefix + v7(), encoded);
        });
      },
    },
    views: {
      subscribe(next, error) {
        const listener = liveQuery(() => db.views.toArray()).subscribe({
          next,
          error,
        });
        return () => listener.unsubscribe();
      },
      async save(view) {
        const name = requiredText(
          view.name,
          "Escribe un nombre para la vista.",
        );
        const id = v7();
        await db.views.add({ ...view, id, name });
        return id;
      },
      remove: (id) => db.views.delete(id),
    },
    sync: {
      bind(userId) {
        return db.transaction("rw", db.settings, async () => {
          const account = await db.settings.get("account");
          if (account && account.value !== userId)
            throw new Error("Esta base local pertenece a otra cuenta.");
          await db.settings.put({ key: "account", value: userId });
        });
      },
      pending: (limit) => db.outbox.limit(limit).toArray(),
      acknowledge: (ids) => db.outbox.bulkDelete(ids),
      async cursor() {
        return (await db.settings.get("cursor"))?.value ?? "0";
      },
      apply(ops, cursor) {
        return db.transaction("rw", writeTables, async () => {
          const previous = (await db.settings.get("cursor"))?.value ?? "0";
          if (BigInt(cursor) <= BigInt(previous)) return;
          let clock = (await db.settings.get("clock"))?.value;
          for (const op of ops) {
            clock = tickHlc(Date.now(), clock, op.hlc);
            if (
              op.kind === "set" &&
              op.entity === "item" &&
              op.field.startsWith(documentPrefix)
            ) {
              if (typeof op.value !== "string")
                throw new Error("Actualización de documento inválida.");
              await applyDocument(op.entityId, op.value);
            } else {
              await materialize(db, op, await mergeReplica(db, op));
            }
          }
          if (clock) await db.settings.put({ key: "clock", value: clock });
          await db.settings.put({ key: "cursor", value: cursor });
        });
      },
    },
    subscribe(next, error) {
      const subscription = liveQuery(() =>
        db.transaction("r", db.items, db.projects, async () => ({
          items: (await db.items.orderBy("[status+order]").toArray()).filter(
            (item) => !item.deletedAt,
          ),
          projects: (await db.projects.orderBy("order").toArray()).filter(
            (project) => !project.deletedAt && !project.archived,
          ),
        })),
      ).subscribe({ next, error });
      return () => subscription.unsubscribe();
    },
    items: {
      create(input) {
        const title = requiredText(
          input.title,
          "Escribe un título para la tarea.",
        );
        return db.transaction("rw", writeTables, async () => {
          await checkProject(input.projectId);
          const id = v7();
          const item: Item = {
            ...input,
            id,
            workspaceId: await workspaceId(),
            title,
            status: "todo",
            order: await nextOrder("todo"),
            tagIds: [],
            props: {},
            notes: "",
          };
          await db.items.add(item);
          await record(db, "item", item);
          return id;
        });
      },
      update(id, changes) {
        return db.transaction("rw", writeTables, async () => {
          const previous = await getItem(id);
          const item = { ...previous };
          if ("projectId" in changes) {
            await checkProject(changes.projectId);
            item.projectId = changes.projectId;
          }
          if (changes.title !== undefined) {
            item.title = requiredText(
              changes.title,
              "Escribe un título para la tarea.",
            );
          }
          if (changes.notes !== undefined) item.notes = changes.notes;
          if ("start" in changes) item.start = changes.start;
          if ("due" in changes) item.due = changes.due;
          if ("allDay" in changes) item.allDay = changes.allDay;
          if ("recurrence" in changes) item.recurrence = changes.recurrence;
          await db.items.put(item);
          await record(db, "item", item, previous);
        });
      },
      setProperty(id, name, value) {
        const key = requiredText(name, "Escribe un nombre para la propiedad.");
        return db.transaction("rw", writeTables, async () => {
          await getItem(id);
          const op = await recordField(db, id, propertyPrefix + key, value);
          await materialize(db, op, await mergeReplica(db, op));
        });
      },
      move(id, status) {
        return db.transaction("rw", writeTables, async () => {
          const item = await getItem(id);
          if (item.status === status) return;
          const next = { ...item, status, order: await nextOrder(status) };
          await db.items.put(next);
          await record(db, "item", next, item);
        });
      },
      remove(id) {
        return db.transaction("rw", writeTables, async () => {
          const task = await db.items.get(id);
          if (task && !task.deletedAt) {
            const next = { ...task, deletedAt: new Date().toISOString() };
            await db.items.put(next);
            await record(db, "item", next, task);
          }
        });
      },
    },
    projects: {
      create(input) {
        const name = requiredText(input, "Escribe un nombre para el proyecto.");
        return db.transaction("rw", writeTables, async () => {
          const last = await db.projects.orderBy("order").last();
          const id = v7();
          const project: Project = {
            id,
            workspaceId: await workspaceId(),
            name,
            order: generateKeyBetween(last?.order ?? null, null),
          };
          await db.projects.add(project);
          await record(db, "project", project);
          return id;
        });
      },
    },
  };
}
