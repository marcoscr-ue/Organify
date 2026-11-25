import { expect, it } from "vitest";
import {
  eventOccurrenceForReminder,
  eventOccurrences,
  mergeOp,
  type EventTiming,
  type Op,
  type Replica,
} from "../../core/src";
import { createOpCodec } from "../../crypto/src";
import {
  MemoryAdapter,
  SyncEngine,
  type SyncStore,
} from "../../sync/src/engine";
import {
  eventExceptionPrefix,
  eventSegmentsField,
  planEventFuture,
  planEventSeries,
  readEventGroup,
} from "../src/event-journal";
import type { EventFutureChanges, EventSeriesChanges } from "../src";
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
  return {
    engine: new SyncEngine(store, adapter, codec),
    replicas,
    tasks,
    saveOffline(op: Op) {
      const key = `${op.entity}:${op.entityId}`;
      replicas.set(key, mergeOp(replicas.get(key) ?? { fields: {} }, op));
      queue.push(op);
    },
  };
}

const eventKey = "item:event/1";
const eventId = "event/1";
const readEvent = (key: string, state: Replica) =>
  readEventGroup(key, state)?.events[0];
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

it("fusiona campos de una ocurrencia de dos dispositivos y conserva su cancelación", async () => {
  const adapter = new MemoryAdapter();
  const prefix = eventExceptionPrefix + "2026-11-25/";
  const timing = { allDay: true, start: "2026-12-02", end: "2026-12-03" };
  const a = device(
    adapter,
    fields("a", "event/1", {
      "event:schedule": {
        timing: { allDay: true, start: "2026-11-25", end: "2026-11-26" },
        recurrence: { frequency: "weekly", interval: 1, until: null },
      },
      "event:title": "Clase",
      [prefix + "timing"]: timing,
    }),
  );
  const b = device(
    adapter,
    fields("b", "event/1", {
      [prefix + "notes"]: "Apuntes",
      [eventExceptionPrefix + "2026-12-02/cancelled"]: true,
      [eventExceptionPrefix + "2026-12-02/title"]: "Edición posterior",
    }),
  );
  adapter.online = false;
  await expect(a.engine.sync()).rejects.toThrow();
  await expect(b.engine.sync()).rejects.toThrow();
  adapter.online = true;
  await b.engine.sync();
  await a.engine.sync();
  await b.engine.sync();
  const left = readEvent(eventKey, a.replicas.get(eventKey)!);
  expect(readEvent(eventKey, b.replicas.get(eventKey)!)).toEqual(left);
  expect(left?.exceptions).toEqual({
    "2026-11-25": { notes: "Apuntes", timing },
    "2026-12-02": { cancelled: true, title: "Edición posterior" },
  });
  expect(a.tasks.size + b.tasks.size).toBe(0);
});

const session = (date: string, hour = "18"): EventTiming => ({
  allDay: false,
  start: `${date}T${hour}:00`,
  end: `${date}T${hour}:45`,
  timeZone: "Europe/Madrid",
});

const originalSeries = fields("origin", eventId, {
  "event:schedule": {
    timing: session("2026-11-03"),
    recurrence: { frequency: "weekly", interval: 1, until: null },
  },
  "event:title": "Clase",
  [eventExceptionPrefix + "2026-11-10T18:00/timing"]: session("2026-12-06"),
  [eventExceptionPrefix + "2026-11-17T18:00/timing"]: session("2026-11-20"),
  [eventExceptionPrefix + "2026-11-24T18:00/cancelled"]: true,
});

function groupFrom(ops: Op[]) {
  return readEventGroup(
    eventKey,
    ops.reduce<Replica>(mergeOp, { fields: {} }),
  )!;
}

function seriesChange(
  ops: Op[],
  cut: string,
  changes: EventFutureChanges | null,
  deviceId: string,
  hlc: string,
  segmentId = eventId,
) {
  const plan = planEventFuture(
    groupFrom(ops),
    segmentId,
    cut,
    changes,
    eventId + "/" + deviceId,
  );
  const [change] = fields(deviceId, eventId, {
    [eventSegmentsField]: plan.segments,
  });
  return { impact: plan.impact, op: { ...change!, hlc } };
}

function wholeSeriesChange(
  ops: Op[],
  changes: EventSeriesChanges | null,
  hlc: string,
) {
  const generation = "series-" + hlc.replace(":", "-");
  const plan = planEventSeries(groupFrom(ops), eventId, changes, generation);
  const [change] = fields(
    generation,
    eventId,
    changes
      ? { [eventSegmentsField]: plan.segments }
      : { "event:removed": true },
  );
  return { ...plan, op: { ...change!, hlc } };
}

function december(ops: Op[]) {
  return eventOccurrences(
    groupFrom(ops).events,
    new Date("2026-12-01"),
    new Date("2026-12-09"),
    "Europe/Madrid",
  )
    .map(({ originalStart, start, event }) => [
      originalStart,
      start,
      event.title,
    ])
    .sort();
}

it("corta desde el inicio previsto de la cita movida y conserva las excepciones anteriores", () => {
  const cut = "2026-11-17T18:00";
  const moved = eventOccurrences(
    groupFrom(originalSeries).events,
    new Date("2026-11-20"),
    new Date("2026-11-21"),
    "Europe/Madrid",
  )[0]!;
  expect(moved.originalStart).toBe(cut);
  const { op, impact } = seriesChange(
    originalSeries,
    moved.originalStart,
    null,
    "cut",
    "2:0",
  );
  expect(impact).toMatchObject({
    exceptions: 2,
    segments: [{ title: "Clase", from: cut }],
  });
  const ops = [...originalSeries, op];
  expect(groupFrom(ops).events).toMatchObject([
    {
      before: cut,
      exceptions: {
        "2026-11-10T18:00": { timing: session("2026-12-06") },
      },
    },
  ]);
  expect(december(ops)).toEqual([
    ["2026-11-10T18:00", "2026-12-06T17:00:00.000Z", "Clase"],
  ]);
});

it("renombra los tramos siguientes con sus horarios, cancelaciones y campos de excepción", () => {
  const scheduling = seriesChange(
    originalSeries,
    "2026-12-01T18:00",
    {
      timing: session("2026-12-01", "19"),
    },
    "schedule",
    "2:0",
  );
  const nextException = fields("exception", eventId, {
    [eventExceptionPrefix + "schedule/2026-12-08T19:00/title"]: "Tutoría",
  });
  const ops = [...originalSeries, scheduling.op, ...nextException];
  const rename = seriesChange(
    ops,
    "2026-11-17T18:00",
    { title: "Curso" },
    "rename",
    "3:0",
  );
  expect(rename.impact).toMatchObject({
    replacesSchedule: false,
    exceptions: 0,
  });
  const renamed = [...ops, rename.op];
  const { events } = groupFrom(renamed);
  expect(events).toMatchObject([
    { title: "Clase", groupId: eventId, before: "2026-11-17T18:00" },
    {
      title: "Curso",
      groupId: eventId,
      before: "2026-12-01T18:00",
      exceptions: {
        "2026-11-17T18:00": { timing: session("2026-11-20") },
        "2026-11-24T18:00": { cancelled: true },
      },
    },
    { title: "Curso", groupId: eventId, timing: session("2026-12-01", "19") },
  ]);
  expect(events[1]?.exceptions).not.toHaveProperty("2026-11-10T18:00");
  expect(december(renamed)).toEqual([
    ["2026-11-10T18:00", "2026-12-06T17:00:00.000Z", "Clase"],
    ["2026-12-01T19:00", "2026-12-01T18:00:00.000Z", "Curso"],
    ["2026-12-08T19:00", "2026-12-08T18:00:00.000Z", "Tutoría"],
  ]);
  const replace = seriesChange(
    renamed,
    "2026-11-17T18:00",
    {
      recurrence: null,
    },
    "replace",
    "4:0",
    eventId + "/rename",
  );
  expect(replace.impact).toMatchObject({
    exceptions: 3,
    segments: [{ from: "2026-11-17T18:00" }, { from: "2026-12-01T19:00" }],
  });
  expect(groupFrom([...renamed, replace.op]).events).toMatchObject([
    { id: eventId, before: "2026-11-17T18:00" },
    {
      id: eventId + "/replace",
      groupId: eventId,
      recurrence: null,
      timing: session("2026-11-17"),
    },
  ]);
});

it.each([
  { first: "a", clockA: "2:0", clockB: "3:0", winner: "b" },
  { first: "b", clockA: "2:0", clockB: "3:0", winner: "b" },
  { first: "a", clockA: "3:0", clockB: "2:0", winner: "a" },
  { first: "b", clockA: "3:0", clockB: "2:0", winner: "a" },
  { first: "b", clockA: "2:0", clockB: "2:0", winner: "b" },
])(
  "converge en $winner con HLC $clockA y $clockB si $first se reconecta primero",
  async ({ first, clockA, clockB, winner }) => {
    const adapter = new MemoryAdapter();
    const origin = device(adapter, originalSeries);
    await origin.engine.sync();
    const a = device(adapter, []);
    const b = device(adapter, []);
    await a.engine.sync();
    await b.engine.sync();
    adapter.online = false;
    const left = seriesChange(
      originalSeries,
      "2026-11-10T18:00",
      {
        timing: session("2026-11-10", "16"),
      },
      "a",
      clockA,
    );
    const right = seriesChange(
      originalSeries,
      "2026-11-17T18:00",
      {
        timing: session("2026-11-17", "19"),
      },
      "b",
      clockB,
    );
    a.saveOffline(left.op);
    b.saveOffline(right.op);
    await expect(a.engine.sync()).rejects.toThrow();
    await expect(b.engine.sync()).rejects.toThrow();
    adapter.online = true;
    const order = first === "a" ? [a, b] : [b, a];
    for (const client of [...order, ...order]) await client.engine.sync();
    const result = readEventGroup(eventKey, b.replicas.get(eventKey)!);
    expect(readEventGroup(eventKey, a.replicas.get(eventKey)!)).toEqual(result);
    expect(groupFrom([right.op, left.op, ...originalSeries, right.op])).toEqual(
      result,
    );
    const cut = winner === "a" ? "2026-11-10" : "2026-11-17";
    expect(result?.events).toMatchObject([
      { id: eventId, before: cut + "T18:00" },
      {
        id: eventId + "/" + winner,
        timing: session(cut, winner === "a" ? "16" : "19"),
      },
    ]);
  },
);

it("renombra todos los tramos conservando los horarios y los campos de cada excepción", () => {
  const split = seriesChange(
    originalSeries,
    "2026-12-01T18:00",
    {
      timing: session("2026-12-01", "19"),
    },
    "schedule",
    "2:0",
  );
  const ops = [
    ...originalSeries,
    split.op,
    ...fields("exception", eventId, {
      [eventExceptionPrefix + "schedule/2026-12-08T19:00/title"]: "Tutoría",
    }),
  ];
  const renamed = wholeSeriesChange(ops, { title: "Curso" }, "3:0");
  expect(renamed.impact).toMatchObject({
    replacesSchedule: false,
    exceptions: 0,
    segments: [],
  });
  expect(december([...ops, renamed.op])).toEqual([
    ["2026-11-10T18:00", "2026-12-06T17:00:00.000Z", "Curso"],
    ["2026-12-01T19:00", "2026-12-01T18:00:00.000Z", "Curso"],
    ["2026-12-08T19:00", "2026-12-08T18:00:00.000Z", "Tutoría"],
  ]);
});

it("confirma las excepciones retiradas y conserva las que generan el mismo inicio previsto", () => {
  const split = seriesChange(
    originalSeries,
    "2026-12-01T18:00",
    {
      timing: session("2026-12-01", "19"),
    },
    "schedule",
    "2:0",
  );
  const ops = [
    ...originalSeries,
    split.op,
    ...fields("exception", eventId, {
      [eventExceptionPrefix + "schedule/2026-12-15T19:00/cancelled"]: true,
    }),
  ];
  const changed = wholeSeriesChange(
    ops,
    { recurrence: { interval: 2 } },
    "3:0",
  );
  expect(changed.impact).toMatchObject({
    replacesSchedule: true,
    exceptions: 2,
    segments: [{ from: "2026-11-03T18:00" }, { from: "2026-12-01T19:00" }],
  });
  const revised = [...ops, changed.op];
  expect(groupFrom(revised).events).toMatchObject([
    { exceptions: { "2026-11-17T18:00": { timing: session("2026-11-20") } } },
    { exceptions: { "2026-12-15T19:00": { cancelled: true } } },
  ]);
  expect(Object.keys(groupFrom(revised).events[0]!.exceptions!)).toEqual([
    "2026-11-17T18:00",
  ]);
  const changedAgain = wholeSeriesChange(
    revised,
    { recurrence: { interval: 1 } },
    "4:0",
  );
  expect(
    Object.keys(
      groupFrom([...revised, changedAgain.op]).events[0]!.exceptions!,
    ),
  ).toEqual(["2026-11-17T18:00"]);
});

it("reinicia la cadencia en el primer evento de cada tramo al cambiar la frecuencia o el intervalo", () => {
  const split = seriesChange(
    originalSeries,
    "2026-11-10T18:00",
    { title: "Tramo renombrado" },
    "rename",
    "2:0",
  );
  const revised = [...originalSeries, split.op];
  const changed = wholeSeriesChange(
    revised,
    { recurrence: { interval: 2 } },
    "3:0",
  );
  const [, successor] = groupFrom([...revised, changed.op]).events;
  expect(successor?.timing.start).toBe("2026-11-10T18:00");
  expect(successor?.exceptions).toEqual({
    "2026-11-10T18:00": { timing: session("2026-12-06") },
    "2026-11-24T18:00": { cancelled: true },
  });
});

it("aplica un cambio global de fecha y conserva los horarios y las reglas propias de cada tramo", () => {
  const split = seriesChange(
    originalSeries,
    "2026-12-01T18:00",
    {
      timing: session("2026-12-01", "19"),
      recurrence: { frequency: "daily", interval: 2, until: "2026-12-31" },
    },
    "schedule",
    "2:0",
  );
  const ops = [...originalSeries, split.op];
  const shifted = wholeSeriesChange(ops, { timing: { dayShift: 1 } }, "3:0");
  expect(groupFrom([...ops, shifted.op]).events).toMatchObject([
    {
      timing: session("2026-11-04"),
      before: "2026-12-02",
      recurrence: { frequency: "weekly", interval: 1 },
    },
    {
      timing: session("2026-12-02", "19"),
      recurrence: { frequency: "daily", interval: 2, until: "2027-01-01" },
    },
  ]);
  expect(shifted.impact).toMatchObject({ exceptions: 3 });
});

it("reasigna una excepción al tramo que ahora genera su inicio y aplica el fin a toda la serie", () => {
  const split = seriesChange(
    originalSeries,
    "2026-12-01T18:00",
    { recurrence: null },
    "single",
    "2:0",
  );
  const recurringSplit = seriesChange(
    originalSeries,
    "2026-12-01T18:00",
    { recurrence: { frequency: "daily", interval: 1, until: null } },
    "daily",
    "2:0",
  );
  const ops = [
    ...originalSeries,
    recurringSplit.op,
    ...fields("exception", eventId, {
      [eventExceptionPrefix + "daily/2026-12-01T18:00/title"]:
        "Inicio del segundo tramo",
    }),
  ];
  const shifted = wholeSeriesChange(ops, { timing: { dayShift: 7 } }, "3:0");
  const [first, second] = groupFrom([...ops, shifted.op]).events;
  expect(first?.exceptions?.["2026-12-01T18:00"]).toEqual({
    title: "Inicio del segundo tramo",
  });
  expect(second?.exceptions?.["2026-12-01T18:00"]).toBeUndefined();
  const limited = wholeSeriesChange(
    [...originalSeries, split.op],
    { recurrence: { until: "2026-11-24" } },
    "3:0",
  );
  expect(limited.segments).toHaveLength(1);
  expect(limited.impact.segments.map(({ from }) => from)).toEqual([
    "2026-11-03T18:00",
    "2026-12-01T18:00",
  ]);
});

it("sincroniza excepciones heredadas y borra todo el grupo aunque lleguen cambios posteriores", async () => {
  const changed = wholeSeriesChange(
    originalSeries,
    { recurrence: { interval: 2 } },
    "3:0",
  );
  const exception = fields("old", eventId, {
    [eventExceptionPrefix + "2026-11-17T18:00/notes"]:
      "Edición con la versión anterior",
  });
  const newer = fields("new", eventId, {
    [eventExceptionPrefix + "series-3-0-0/2026-11-17T18:00/title"]:
      "Clase especial",
  });
  const revised = [...originalSeries, changed.op, ...exception, ...newer];
  const removed = wholeSeriesChange(revised, null, "4:0");
  const lateEdit = wholeSeriesChange(
    revised,
    { title: "Edición offline" },
    "5:0",
  );
  expect(removed.impact.exceptions).toBe(1);
  const adapter = new MemoryAdapter();
  const a = device(adapter, [...revised, lateEdit.op]);
  const b = device(adapter, [removed.op]);
  await b.engine.sync();
  await a.engine.sync();
  await b.engine.sync();
  for (const client of [a, b]) {
    expect(client.replicas.get(eventKey)?.fields[eventSegmentsField]).toEqual(
      lateEdit.op,
    );
    expect(
      readEventGroup(eventKey, client.replicas.get(eventKey)!),
    ).toBeUndefined();
  }
  expect(groupFrom(revised).events[0]?.exceptions).toEqual({
    "2026-11-17T18:00": {
      title: "Clase especial",
      notes: "Edición con la versión anterior",
      timing: session("2026-11-20"),
    },
  });
  expect(
    eventOccurrences(
      groupFrom(revised).events,
      new Date("2026-11-20"),
      new Date("2026-11-21"),
      "Europe/Madrid",
    ),
  ).toMatchObject([{ originalStart: "2026-11-17T18:00" }]);
});

it("sincroniza el recordatorio de la serie, respeta una exclusión puntual y conserva el ajuste al dividir", async () => {
  const ops = [
    ...originalSeries,
    ...fields("reminder", eventId, {
      "event:reminderMinutes": 15,
      [eventExceptionPrefix + "2026-11-17T18:00/reminderMinutes"]: null,
    }),
  ];
  const split = seriesChange(
    ops,
    "2026-12-01T18:00",
    { timing: session("2026-12-01", "19") },
    "split",
    "2:0",
  );
  const whole = wholeSeriesChange(
    [...ops, split.op],
    { reminderMinutes: 60 },
    "3:0",
  );
  const adapter = new MemoryAdapter();
  const a = device(adapter, [...ops, split.op, whole.op]);
  const b = device(adapter, []);
  await a.engine.sync();
  await b.engine.sync();
  const events = readEventGroup(eventKey, b.replicas.get(eventKey)!)!.events;
  expect(events.map((event) => event.reminderMinutes)).toEqual([60, 60]);
  expect(
    groupFrom([...ops, split.op]).events.map((event) => event.reminderMinutes),
  ).toEqual([15, 15]);
  expect(
    eventOccurrenceForReminder(events, `${eventId}/2026-11-17T18:00`),
  ).toMatchObject({
    event: { reminderMinutes: null },
    start: "2026-11-20T17:00:00.000Z",
  });
  expect(
    eventOccurrenceForReminder(events, `${eventId}/2026-11-24T18:00`),
  ).toBeUndefined();
});
