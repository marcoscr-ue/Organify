import * as Y from "yjs";
import Dexie, { liveQuery, type Table } from "dexie";
import { generateKeyBetween } from "fractional-indexing";
import { v7 } from "uuid";
import type {
  Id,
  Item,
  Json,
  Project,
  Op,
  Replica,
  RoutineSchedule,
  EventInput,
} from "@organify/core";
import {
  isEventSchedule,
  isEventOccurrenceStart,
  isProjectColor,
  isRoutineSchedule,
  routineDate,
  routineProgress,
  taskDuration,
  taskDurationFields,
  tickHlc,
} from "@organify/core";
import {
  documentPrefix,
  materialize,
  mergeReplica,
  propertyPrefix,
  record,
  recordField,
} from "./journal";
import type { SavedView, TaskRepositories } from "./index";
import { readRoutine, routineKeyPrefix } from "./routine-journal";
import {
  eventExceptionPrefix,
  eventIdPrefix,
  eventKeyPrefix,
  readEvent,
} from "./event-journal";

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
    this.version(4)
      .stores({})
      .upgrade(async (tx) => {
        // Older clients kept color operations in the journal without displaying them.
        const projects = tx.table<Project, Id>("projects");
        const ids = await projects.toCollection().primaryKeys();
        const replicas = await tx
          .table<{ key: string; state: Replica }, string>("replicas")
          .bulkGet(ids.map((id) => `project:${id}`));
        for (const row of replicas) {
          const color = row?.state.fields.color;
          if (color && isProjectColor(color.value)) {
            await projects.update(color.entityId, { color: color.value });
          }
        }
      });
  }
}

function requiredText(value: string, message: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(message);
  return trimmed;
}

function cleanSchedule(input: RoutineSchedule): RoutineSchedule {
  const schedule = {
    frequency: input.frequency,
    steps: input.steps.map(({ id, label }) => ({ id, label: label.trim() })),
  };
  if (!isRoutineSchedule(schedule))
    throw new Error("Añade al menos un paso y escribe su nombre.");
  return schedule;
}

function scheduleValue({ frequency, steps }: RoutineSchedule) {
  return { frequency, steps: steps.map(({ id, label }) => ({ id, label })) };
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

  async function getProject(id: Id): Promise<Project> {
    const project = await db.projects.get(id);
    if (!project || project.deletedAt || project.archived) {
      throw new Error("El proyecto ya no está disponible.");
    }
    return project;
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

  function removeItems(ids: readonly Id[]) {
    return db.transaction("rw", writeTables, async () => {
      const deletedAt = new Date().toISOString();
      for (const id of ids) {
        const item = await db.items.get(id);
        if (!item || item.deletedAt) continue;
        const next = { ...item, deletedAt };
        await db.items.put(next);
        await record(db, "item", next, item);
      }
    });
  }

  async function getRoutine(id: Id) {
    const key = "item:" + id;
    const row =
      key.startsWith(routineKeyPrefix) && (await db.replicas.get(key));
    const routine = row && readRoutine(key, row.state);
    if (!routine) throw new Error("La rutina ya no está disponible.");
    return routine;
  }

  async function setRoutineField(id: Id, field: string, value: Json) {
    await mergeReplica(
      db,
      await recordField(db, id, "routine:" + field, value),
    );
  }

  async function getEvent(id: Id) {
    const key = "item:" + id;
    const row = key.startsWith(eventKeyPrefix) && (await db.replicas.get(key));
    const event = row && readEvent(key, row.state);
    if (!event) throw new Error("El evento ya no está disponible.");
    return event;
  }

  async function getSingleEvent(id: Id) {
    const event = await getEvent(id);
    if (event.recurrence)
      throw new Error("Esta versión solo permite consultar series.");
    return event;
  }

  async function getOccurrence(id: Id, originalStart: string) {
    const event = await getEvent(id);
    if (!isEventOccurrenceStart(event, originalStart))
      throw new Error("Esta ocurrencia ya no pertenece a la serie.");
    return event.exceptions?.[originalStart] ?? {};
  }

  async function setExceptionField(
    id: Id,
    start: string,
    field: string,
    value: Json,
  ) {
    await mergeReplica(
      db,
      await recordField(
        db,
        id,
        `${eventExceptionPrefix}${start}/${field}`,
        value,
      ),
    );
  }

  async function setEventField(id: Id, field: string, value: Json) {
    await mergeReplica(db, await recordField(db, id, "event:" + field, value));
  }

  async function saveEvent(id: Id, input: EventInput, previous?: EventInput) {
    const title = requiredText(
      input.title,
      "Escribe un título para el evento.",
    );
    const { timing, recurrence, color } = input;
    const notes = input.notes.trim();
    if (!isEventSchedule({ timing, recurrence }))
      throw new Error(
        "Comprueba las fechas, las horas y la repetición del evento.",
      );
    if (color !== null && !isProjectColor(color))
      throw new Error("El color del evento no es válido.");
    const schedule = { timing, recurrence };
    if (
      !previous ||
      JSON.stringify(schedule) !==
        JSON.stringify({
          timing: previous.timing,
          recurrence: previous.recurrence,
        })
    )
      await setEventField(id, "schedule", schedule);
    if (title !== previous?.title) await setEventField(id, "title", title);
    if (notes !== (previous?.notes ?? ""))
      await setEventField(id, "notes", notes);
    if (color !== (previous?.color ?? null))
      await setEventField(id, "color", color);
  }

  return {
    events: {
      create(input) {
        return db.transaction("rw", writeTables, async () => {
          const id = eventIdPrefix + v7();
          await saveEvent(id, input);
          return id;
        });
      },
      update(id, changes) {
        return db.transaction("rw", writeTables, async () => {
          const previous = await getSingleEvent(id);
          await saveEvent(
            id,
            { ...previous, ...changes, recurrence: null },
            previous,
          );
        });
      },
      remove(id) {
        return db.transaction("rw", writeTables, async () => {
          await getSingleEvent(id);
          await setEventField(id, "removed", true);
        });
      },
      updateOccurrence(id, originalStart, changes) {
        return db.transaction("rw", writeTables, async () => {
          const previous = await getOccurrence(id, originalStart);
          if (previous.cancelled)
            throw new Error("Esta ocurrencia ya está cancelada.");
          const { title, notes, color, timing } = changes;
          if (title !== undefined && title !== previous.title)
            await setExceptionField(
              id,
              originalStart,
              "title",
              requiredText(title, "Escribe un título para el evento."),
            );
          if (notes !== undefined && notes !== previous.notes)
            await setExceptionField(id, originalStart, "notes", notes.trim());
          if (color !== undefined && color !== previous.color) {
            if (color !== null && !isProjectColor(color))
              throw new Error("El color del evento no es válido.");
            await setExceptionField(id, originalStart, "color", color);
          }
          if (
            timing &&
            JSON.stringify(timing) !== JSON.stringify(previous.timing)
          ) {
            if (!isEventSchedule({ timing, recurrence: null }))
              throw new Error("Comprueba las fechas y las horas del evento.");
            await setExceptionField(id, originalStart, "timing", timing);
          }
        });
      },
      cancelOccurrence(id, originalStart) {
        return db.transaction("rw", writeTables, async () => {
          const previous = await getOccurrence(id, originalStart);
          if (!previous.cancelled)
            await setExceptionField(id, originalStart, "cancelled", true);
        });
      },
    },
    routines: {
      create(input) {
        const name = requiredText(
          input.name,
          "Escribe un nombre para la rutina.",
        );
        const schedule = cleanSchedule(input);
        return db.transaction("rw", writeTables, async () => {
          const id = "routine/" + v7();
          const timeZone =
            Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
          const date = routineDate(Date.now(), timeZone);
          await setRoutineField(id, "name", name);
          await setRoutineField(id, "zone", timeZone);
          await setRoutineField(id, "start", date);
          await setRoutineField(
            id,
            "schedule:" + date,
            scheduleValue(schedule),
          );
          return id;
        });
      },
      update(id, changes) {
        const name =
          changes.name === undefined
            ? undefined
            : requiredText(changes.name, "Escribe un nombre para la rutina.");
        const schedule = changes.schedule && cleanSchedule(changes.schedule);
        return db.transaction("rw", writeTables, async () => {
          const routine = await getRoutine(id);
          const { cycle, nextSchedule } = routineProgress(routine, Date.now());
          if (name !== undefined && name !== routine.name)
            await setRoutineField(id, "name", name);
          if (!schedule) return;
          const next = scheduleValue(schedule);
          if (
            JSON.stringify(next) !== JSON.stringify(scheduleValue(nextSchedule))
          )
            await setRoutineField(id, "schedule:" + cycle.end, next);
        });
      },
      setPaused(id, paused) {
        return db.transaction("rw", writeTables, async () => {
          const routine = await getRoutine(id);
          const { cycle, nextPaused } = routineProgress(routine, Date.now());
          if (nextPaused !== paused)
            await setRoutineField(id, "pause:" + cycle.end, paused);
        });
      },
      setStep(id, start, step, checked) {
        return db.transaction("rw", writeTables, async () => {
          const routine = await getRoutine(id);
          const { cycle, started } = routineProgress(routine, Date.now());
          if (!started || cycle.start !== start || cycle.paused)
            throw new Error("El ciclo ha cambiado. Abre la checklist actual.");
          if (!cycle.steps.some(({ id }) => id === step))
            throw new Error("Este paso ya no está disponible.");
          if (cycle.checked.has(step) !== checked)
            await setRoutineField(id, `check:${start}:${step}`, checked);
        });
      },
      remove(id) {
        return db.transaction("rw", writeTables, async () => {
          await getRoutine(id);
          await setRoutineField(id, "removed", true);
        });
      },
    },
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
        db.transaction("r", db.items, db.projects, db.replicas, async () => ({
          items: (await db.items.orderBy("[status+order]").toArray()).filter(
            (item) => !item.deletedAt,
          ),
          projects: (await db.projects.orderBy("order").toArray()).filter(
            (project) => !project.deletedAt && !project.archived,
          ),
          events: (
            await db.replicas.where(":id").startsWith(eventKeyPrefix).toArray()
          ).flatMap(({ key, state }) => {
            const event = readEvent(key, state);
            return event ? [event] : [];
          }),
          routines: (
            await db.replicas
              .where(":id")
              .startsWith(routineKeyPrefix)
              .toArray()
          ).flatMap(({ key, state }) => {
            const routine = readRoutine(key, state);
            return routine ? [routine] : [];
          }),
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
          if (input.projectId) await getProject(input.projectId);
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
            if (changes.projectId) await getProject(changes.projectId);
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
          for (const field of taskDurationFields) {
            if (!(field in changes)) continue;
            const value = changes[field];
            if (value === taskDuration(previous, field)) continue;
            const op = await recordField(
              db,
              id,
              propertyPrefix + field,
              value ?? null,
            );
            await materialize(db, op, await mergeReplica(db, op));
          }
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
      remove: (id) => removeItems([id]),
      removeMany: removeItems,
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
      update(id, changes) {
        return db.transaction("rw", writeTables, async () => {
          const previous = await getProject(id);
          const project = { ...previous };
          if (changes.name !== undefined) {
            project.name = requiredText(
              changes.name,
              "Escribe un nombre para el proyecto.",
            );
          }
          if ("color" in changes) {
            if (changes.color !== undefined && !isProjectColor(changes.color)) {
              throw new Error("Elige un color válido para el proyecto.");
            }
            project.color = changes.color?.toLowerCase();
          }
          await db.projects.put(project);
          await record(db, "project", project, previous);
        });
      },
    },
  };
}
