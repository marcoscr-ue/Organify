import {
  eventDuration,
  isEventOccurrenceStart,
  isEventSchedule,
  isProjectColor,
  isRoutineDate,
  plannedEventTiming,
  type CalendarEvent,
  type EventException,
  type EventInput,
  type Replica,
} from "@organify/core";
import type { EventFutureChanges, EventFutureImpact } from "./index";

export const eventIdPrefix = "event/";
export const eventKeyPrefix = "item:" + eventIdPrefix;
export const eventExceptionPrefix = "event:occurrence/";
export const eventSegmentsField = "event:segments";

type EventSegment = Pick<EventInput, keyof EventInput> & {
  id: string;
  // Metadata splits share the same exceptions. A new schedule gets a new source.
  source: string;
  from: string | null;
  before: string | null;
  duration?: number;
};

function readExceptions(state: Replica) {
  const exceptions = new Map<string, Map<string, EventException>>();
  for (const [key, { value }] of Object.entries(state.fields)) {
    if (!key.startsWith(eventExceptionPrefix)) continue;
    const parts = key.slice(eventExceptionPrefix.length).split("/");
    const [source, start, field] = parts.length === 2 ? ["", ...parts] : parts;
    if (!start || !field) continue;
    const byStart = exceptions.get(source) ?? new Map<string, EventException>();
    const change = byStart.get(start) ?? {};
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
    if (Object.keys(change).length) {
      byStart.set(start, change);
      exceptions.set(source, byStart);
    }
  }
  return exceptions;
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
  const { id, source, from, before, duration, title, notes, color } =
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
  const exceptions = readExceptions(state);
  const events: CalendarEvent[] = segments.map(({ source, ...segment }) => {
    const event = { ...segment, groupId };
    return {
      ...event,
      ...(event.recurrence && {
        exceptions: Object.fromEntries(
          [...(exceptions.get(source) ?? [])].filter(([start]) =>
            isEventOccurrenceStart(event, start),
          ),
        ),
      }),
    };
  });
  return { segments, events, revision: revision?.id ?? "" };
}

function firstSegmentStart({ from, timing }: EventSegment) {
  return from && from > timing.start ? from : timing.start;
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
          from: offset === 0 ? cut : firstSegmentStart(segment),
        }))
      : [],
    exceptions: removed.reduce((count, starts) => count + starts.length, 0),
    revision: JSON.stringify([group.revision, removed]),
  };
  const segments = group.segments.slice(0, index);
  if (cut !== firstSegmentStart(selected))
    segments.push({ ...selected, before: cut });
  if (!changes || !Object.keys(changes).length)
    return { impact, segments: changes ? group.segments : segments };

  const { timing, recurrence, title, notes, color } = changes;
  if (title !== undefined && !title.trim())
    throw new Error("Escribe un título para el evento.");
  if (color !== undefined && color !== null && !isProjectColor(color))
    throw new Error("El color del evento no es válido.");
  const metadata = {
    ...(title !== undefined && { title: title.trim() }),
    ...(notes !== undefined && { notes: notes.trim() }),
    ...(color !== undefined && { color }),
  };
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
    const { duration, ...previous } = selected;
    segments.push({
      ...previous,
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
