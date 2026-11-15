import Dexie, { liveQuery, type Table } from "dexie";
import { generateKeyBetween } from "fractional-indexing";
import { v7 } from "uuid";
import type { Id, Item, Project } from "@organify/core";
import type { TaskRepositories } from "./index";

class OrganifyDatabase extends Dexie {
  declare items: Table<Item, Id>;
  declare projects: Table<Project, Id>;
  declare settings: Table<{ key: "workspace"; value: Id }, "workspace">;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      items: "id, [status+order]",
      projects: "id, order",
      settings: "key",
    });
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

  return {
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
        return db.transaction(
          "rw",
          db.items,
          db.projects,
          db.settings,
          async () => {
            await checkProject(input.projectId);
            const id = v7();
            await db.items.add({
              ...input,
              id,
              workspaceId: await workspaceId(),
              title,
              status: "todo",
              order: await nextOrder("todo"),
              tagIds: [],
              props: {},
              notes: "",
            });
            return id;
          },
        );
      },
      update(id, changes) {
        return db.transaction("rw", db.items, db.projects, async () => {
          const item = await getItem(id);
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
        });
      },
      move(id, status) {
        return db.transaction("rw", db.items, async () => {
          const item = await getItem(id);
          if (item.status === status) return;
          await db.items.update(id, { status, order: await nextOrder(status) });
        });
      },
      remove(id) {
        return db.transaction("rw", db.items, async () => {
          const task = await db.items.get(id);
          if (task && !task.deletedAt) {
            await db.items.update(id, { deletedAt: new Date().toISOString() });
          }
        });
      },
    },
    projects: {
      create(input) {
        const name = requiredText(input, "Escribe un nombre para el proyecto.");
        return db.transaction("rw", db.projects, db.settings, async () => {
          const last = await db.projects.orderBy("order").last();
          const id = v7();
          await db.projects.add({
            id,
            workspaceId: await workspaceId(),
            name,
            order: generateKeyBetween(last?.order ?? null, null),
          });
          return id;
        });
      },
    },
  };
}
