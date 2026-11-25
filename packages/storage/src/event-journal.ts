import {
  compareOps,
  eventDuration,
  firstEventStart,
  isEventOccurrenceStart,
  isEventSchedule,
  isProjectColor,
  isRoutineDate,
  plannedEventTiming,
  shiftRoutineDate,
  type CalendarEvent,
  type EventException,
  type EventInput,
  type EventTiming,
  type Replica,
} from "@organify/core";
import type {
  EventFutureChanges,
  EventFutureImpact,
  EventSeriesChanges,
} from "./index";

export const eventIdPrefix = "event/";
export const eventKeyPrefix = "item:" + eventIdPrefix;
export const eventExceptionPrefix = "event:occurrence/";
export const eventSegmentsField = "event:segments";

type EventSegment = Pick<EventInput, keyof EventInput> & {
  id: string;
  // Metadata splits share the same exceptions. A new schedule gets a new source.
  source: string;
  inherited?: { source: string; starts: Record<string, string[]> };
  from: string | null;
  before: string | null;
  duration?: number;
};

function exceptionFields(state: Replica) {
  const exceptions = new Map<string, Map<string, Replica["fields"]>>();
  for (const [key, op] of Object.entries(state.fields)) {
    if (!key.startsWith(eventExceptionPrefix)) continue;
    const parts = key.slice(eventExceptionPrefix.length).split("/");
    if (parts.length !== 2 && parts.length !== 3) continue;
    const [source, start, field] = parts.length === 2 ? ["", ...parts] : parts;
    if (
      !start ||
      !field ||
      !["title", "notes", "color", "timing", "cancelled"].includes(field)
    )
      continue;
    const byStart =
      exceptions.get(source) ?? new Map<string, Replica["fields"]>();
    const fields = byStart.get(start) ?? {};
    fields[field] = op;
    byStart.set(start, fields);
    exceptions.set(source, byStart);
  }
  return exceptions;
}

function readException(fields: Replica["fields"]) {
  const change: EventException = {};
  for (const [field, { value }] of Object.entries(fields)) {
    switch (field) {
      case "title":
        if (typeof value === "string" && value.trim()) change.title = value;
        break;
      case "notes":
        if (typeof value === "string") change.notes = value;
        break;
      case "color":
        if (value === null || isProjectColor(value)) change.color = value;
        break;
      case "timing": {
        const schedule = { timing: value, recurrence: null };
        if (isEventSchedule(schedule)) change.timing = schedule.timing;
        break;
      }
      case "cancelled":
        if (value === true) change.cancelled = true;
        break;
      default:
        continue;
    }
  }
  return change;
}

function mergeExceptionFields(
  current: Replica["fields"],
  previous: Replica["fields"],
) {
  const fields = { ...current };
  for (const [field, op] of Object.entries(previous)) {
    const existing = fields[field];
    if (
      !existing ||
      compareOps(op, existing) > 0 ||
      (field === "cancelled" && op.value === true)
    )
      fields[field] = op;
  }
  return fields;
}

function readRoot(key: string, state: Replica): CalendarEvent | undefined {
  if (
    !key.startsWith(eventKeyPrefix) ||
    state.fields["event:removed"]?.value === true
  )
    return;
  const title = state.fields["event:title"]?.value;
  const notes = state.fields["event:notes"]?.value;
  const color = state.fields["event:color"]?.value;
  const schedule = state.fields["event:schedule"]?.value;
  if (typeof title !== "string" || !title.trim() || !isEventSchedule(schedule))
    return;
  const id = key.slice("item:".length);
  return {
    id,
    groupId: schedule.recurrence ? id : null,
    title,
    notes: typeof notes === "string" ? notes : "",
    color: isProjectColor(color) ? color : null,
    timing: schedule.timing,
    recurrence: schedule.recurrence,
  };
}

function isSegment(value: unknown, root: string): value is EventSegment {
  if (!isEventSchedule(value)) return false;
  const { id, source, from, before, duration, title, notes, color, inherited } =
    value as Partial<EventSegment>;
  return (
    typeof id === "string" &&
    (id === root || id.startsWith(root + "/")) &&
    typeof source === "string" &&
    !source.includes("/") &&
    isSegmentBoundary(from) &&
    isSegmentBoundary(before) &&
    (duration === undefined ||
      (Number.isSafeInteger(duration) && duration > 0)) &&
    (inherited === undefined ||
      (inherited &&
        typeof inherited.source === "string" &&
        inherited.starts &&
        typeof inherited.starts === "object" &&
        Object.values(inherited.starts).every(
          (sources) =>
            Array.isArray(sources) &&
            sources.every(
              (entry) => typeof entry === "string" && !entry.includes("/"),
            ),
        ))) &&
    typeof title === "string" &&
    !!title.trim() &&
    typeof notes === "string" &&
    (color === null || isProjectColor(color))
  );
}

function isSegmentBoundary(value: unknown) {
  return (
    value === null ||
    (typeof value === "string" &&
      /^(\d{4}-\d{2}-\d{2})(T(?:[01]\d|2[0-3]):[0-5]\d)?$/.test(value) &&
      isRoutineDate(value.slice(0, 10)))
  );
}

export function eventGroupId(id: string) {
  return id.split("/", 2).join("/");
}

export function readEventGroup(key: string, state: Replica) {
  const root = readRoot(key, state);
  if (!root) return;
  const revision = state.fields[eventSegmentsField];
  const value = revision?.value;
  const { groupId, ...input } = root;
  // A single LWW field chooses the complete active timeline, even when
  // competing cuts and their exception operations arrive in different batches.
  const segments: EventSegment[] =
    groupId &&
    Array.isArray(value) &&
    value.every((segment) => isSegment(segment, groupId))
      ? value
      : [{ ...input, source: "", from: null, before: null }];
  const exceptions = exceptionFields(state);
  const events: CalendarEvent[] = segments.map(
    ({ source, inherited, ...segment }) => {
      const event = { ...segment, groupId };
      const active = new Map(exceptions.get(source));
      if (inherited?.source === source) {
        for (const [start, sources] of Object.entries(inherited.starts)) {
          for (const previousSource of sources) {
            const fields = exceptions.get(previousSource)?.get(start);
            if (fields)
              active.set(
                start,
                mergeExceptionFields(active.get(start) ?? {}, fields),
              );
          }
        }
      }
      return {
        ...event,
        ...(event.recurrence && {
          exceptions: Object.fromEntries(
            [...active].flatMap(([start, fields]) => {
              if (!isEventOccurrenceStart(event, start)) return [];
              const exception = readException(fields);
              return Object.keys(exception).length ? [[start, exception]] : [];
            }),
          ),
        }),
      };
    },
  );
  return { segments, events, revision: revision?.id ?? "" };
}

function eventExceptionSources(segment: EventSegment, start: string) {
  const { source, inherited } = segment;
  return inherited?.source === source && Object.hasOwn(inherited.starts, start)
    ? [source, ...inherited.starts[start]!]
    : [source];
}

function eventMetadata({
  title,
  notes,
  color,
}: Partial<Pick<EventInput, "title" | "notes" | "color">>) {
  if (title !== undefined && !title.trim())
    throw new Error("Escribe un título para el evento.");
  if (color !== undefined && color !== null && !isProjectColor(color))
    throw new Error("El color del evento no es válido.");
  return {
    ...(title !== undefined && { title: title.trim() }),
    ...(notes !== undefined && { notes: notes.trim() }),
    ...(color !== undefined && { color }),
  };
}

export function planEventFuture(
  group: NonNullable<ReturnType<typeof readEventGroup>>,
  id: string,
  cut: string,
  changes: EventFutureChanges | null,
  successorId: string,
) {
  const index = group.events.findIndex((event) => event.id === id);
  const event = group.events[index];
  if (!event || !isEventOccurrenceStart(event, cut))
    throw new Error("Esta ocurrencia ya no pertenece a la serie.");

  const selected = group.segments[index]!;
  const replacesSchedule =
    !changes ||
    changes.timing !== undefined ||
    changes.recurrence !== undefined;
  const tail = group.events.slice(index);
  const removed = replacesSchedule
    ? tail.map((segment, offset) =>
        Object.keys(segment.exceptions ?? {})
          .filter((start) => offset > 0 || start >= cut)
          .sort(),
      )
    : [];
  const impact: EventFutureImpact = {
    replacesSchedule,
    segments: replacesSchedule
      ? group.segments.slice(index).map((segment, offset) => ({
          title: segment.title,
          from: offset === 0 ? cut : firstEventStart(segment),
        }))
      : [],
    exceptions: removed.reduce((count, starts) => count + starts.length, 0),
    revision: JSON.stringify([group.revision, removed]),
  };
  const segments = group.segments.slice(0, index);
  if (cut !== firstEventStart(selected))
    segments.push({ ...selected, before: cut });
  if (!changes || !Object.keys(changes).length)
    return { impact, segments: changes ? group.segments : segments };

  const { timing, recurrence } = changes;
  const metadata = eventMetadata(changes);
  if (!replacesSchedule) {
    segments.push(
      { ...selected, ...metadata, id: successorId, from: cut },
      ...group.segments
        .slice(index + 1)
        .map((segment) => ({ ...segment, ...metadata })),
    );
  } else {
    const schedule = {
      timing: timing ?? plannedEventTiming(event.timing, cut),
      recurrence: recurrence === undefined ? event.recurrence : recurrence,
    };
    const from = cut.slice(0, 10);
    if (!isEventSchedule(schedule) || schedule.timing.start < from)
      throw new Error(
        "Comprueba la repetición y elige un inicio a partir del día del corte.",
      );
    const { duration } = selected;
    segments.push({
      title: selected.title,
      notes: selected.notes,
      color: selected.color,
      ...metadata,
      ...schedule,
      id: successorId,
      source: successorId.slice(eventGroupId(id).length + 1),
      from,
      before: null,
      ...(!timing && { duration: duration ?? eventDuration(event.timing) }),
    });
  }
  return { impact, segments };
}

function shiftedDate(date: string, days: number) {
  if (!days) return date;
  const shifted = shiftRoutineDate(date, days);
  if (!isRoutineDate(shifted) || shifted.startsWith("0000"))
    throw new Error(
      "El desplazamiento deja un tramo fuera del rango de fechas.",
    );
  return shifted;
}

function editSegmentSchedule(
  segment: EventSegment,
  changes: EventSeriesChanges,
) {
  const { recurrence: rule, timing: patch } = changes;
  const first = firstEventStart(segment);
  const dayShift = patch?.dayShift ?? 0;
  const date = shiftedDate(first.slice(0, 10), dayShift);
  const recurrence = segment.recurrence && { ...segment.recurrence, ...rule };
  if (recurrence?.until && rule?.until === undefined)
    recurrence.until = shiftedDate(recurrence.until, dayShift);
  const until = rule?.until ?? recurrence?.until;
  if (until && until < date) return;

  let timing = segment.timing;
  let duration = segment.duration;
  let { from, before } = segment;
  if (patch) {
    const allDay = patch.allDay ?? timing.allDay;
    const start = allDay
      ? date
      : `${date}T${patch.startTime ?? (timing.allDay ? "09:00" : first.slice(11))}`;
    const changedDuration =
      patch.duration?.allDay === allDay
        ? patch.duration.milliseconds
        : undefined;
    const previousDuration = duration ?? eventDuration(timing);
    const milliseconds = changedDuration ?? previousDuration;
    const endDate = new Date(
      Date.parse(allDay ? start : start + "Z") + milliseconds,
    );
    if (!Number.isFinite(+endDate))
      throw new Error("Comprueba la fecha y la duración de la serie.");
    const end = endDate.toISOString().slice(0, allDay ? 10 : 16);
    const next: EventTiming = allDay
      ? { allDay, start, end }
      : {
          allDay,
          start,
          end,
          timeZone: timing.allDay ? (patch.timeZone ?? "UTC") : timing.timeZone,
        };
    if (start !== first || milliseconds !== previousDuration) {
      timing = next;
      duration = milliseconds;
      from = from && shiftedDate(from.slice(0, 10), dayShift);
      before = before && shiftedDate(before.slice(0, 10), dayShift);
    }
  }
  // Metadata splits can share an anchor. A changed cadence starts at each
  // segment's own first occurrence so the boundary stays in the series.
  if (
    timing === segment.timing &&
    first !== timing.start &&
    (recurrence?.frequency !== segment.recurrence?.frequency ||
      recurrence?.interval !== segment.recurrence?.interval)
  ) {
    duration ??= eventDuration(timing);
    timing = plannedEventTiming(timing, first);
  }
  if (!isEventSchedule({ timing, recurrence })) {
    throw new Error(
      "Comprueba las fechas, las horas y la repetición de la serie.",
    );
  }
  return {
    ...segment,
    timing,
    recurrence,
    from,
    before,
    ...(duration !== undefined && { duration }),
  };
}

export function planEventSeries(
  group: NonNullable<ReturnType<typeof readEventGroup>>,
  id: string,
  changes: EventSeriesChanges | null,
  generation: string,
) {
  if (!group.events.some((event) => event.id === id && event.recurrence))
    throw new Error("Esta serie ya no está disponible.");
  const impact: EventFutureImpact = {
    replacesSchedule: !changes || !!(changes.timing || changes.recurrence),
    segments: [],
    exceptions: 0,
    revision: group.revision,
  };
  const metadata = changes ? eventMetadata(changes) : {};
  if (!impact.replacesSchedule)
    return {
      impact,
      segments: group.segments.map((segment) => ({ ...segment, ...metadata })),
    };

  const segments: EventSegment[] = [];
  for (const [index, segment] of group.segments.entries()) {
    const next = changes && editSegmentSchedule(segment, changes);
    const scheduleChanged =
      !next ||
      next.timing !== segment.timing ||
      next.recurrence?.frequency !== segment.recurrence?.frequency ||
      next.recurrence?.interval !== segment.recurrence?.interval ||
      next.recurrence?.until !== segment.recurrence?.until;
    if (scheduleChanged)
      impact.segments.push({
        title: segment.title,
        from: firstEventStart(segment),
      });
    if (next) {
      const source = scheduleChanged
        ? `${generation}-${index}`
        : segment.source;
      segments.push({
        ...next,
        ...metadata,
        source,
        inherited: {
          source,
          starts:
            !scheduleChanged && segment.inherited?.source === source
              ? { ...segment.inherited.starts }
              : {},
        },
      });
    }
  }
  if (changes && !impact.segments.length) {
    impact.replacesSchedule = false;
    return {
      impact,
      segments: group.segments.map((segment) => ({ ...segment, ...metadata })),
    };
  }

  const originals = new Map<string, string[][]>();
  for (const [index, event] of group.events.entries()) {
    for (const start of Object.keys(event.exceptions ?? {})) {
      const sources = originals.get(start) ?? [];
      sources.push(eventExceptionSources(group.segments[index]!, start));
      originals.set(start, sources);
    }
  }
  const groupId = eventGroupId(id);
  for (const [start, sources] of originals) {
    const matches = segments.filter((segment) =>
      isEventOccurrenceStart({ ...segment, groupId }, start),
    );
    const [match] = matches;
    if (sources.length === 1 && matches.length === 1 && match?.inherited) {
      const previousSources = sources[0]!.filter(
        (source) => source !== match.source,
      );
      if (previousSources.length)
        match.inherited.starts[start] = previousSources;
    } else impact.exceptions += sources.length;
  }
  impact.revision = JSON.stringify([
    group.revision,
    [...originals].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  ]);
  return { impact, segments };
}
