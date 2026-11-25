import { isRoutineDate, routineDate } from "./routines";

const day = 86_400_000;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const dateTime = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;

export const eventFrequencies = ["daily", "weekly", "monthly"] as const;

export type EventRecurrence = {
  frequency: (typeof eventFrequencies)[number];
  interval: number;
  until: string | null;
};

export type EventTiming =
  | { allDay: true; start: string; end: string }
  | { allDay: false; start: string; end: string; timeZone: string };

export interface EventSchedule {
  timing: EventTiming;
  recurrence: EventRecurrence | null;
}

export interface EventInput extends EventSchedule {
  title: string;
  notes: string;
  color: string | null;
}

export interface CalendarEvent extends EventInput {
  id: string;
  groupId: string | null;
}

export interface EventOccurrence {
  id: string;
  event: CalendarEvent;
  originalStart: string;
  start: string;
  end: string;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();

function zoneFormat(timeZone: string) {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("sv-SE", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    zoneFormats.set(timeZone, format);
  }
  return format;
}

export function isEventSchedule(value: unknown): value is EventSchedule {
  if (!value || typeof value !== "object") return false;
  const { timing, recurrence } = value as Partial<EventSchedule>;
  if (!timing || typeof timing !== "object") return false;
  const { allDay, start, end } = timing;
  if (typeof allDay !== "boolean") return false;
  const pattern = allDay ? dateOnly : dateTime;
  if (
    typeof start !== "string" ||
    typeof end !== "string" ||
    !pattern.test(start) ||
    !pattern.test(end) ||
    !isRoutineDate(start.slice(0, 10)) ||
    !isRoutineDate(end.slice(0, 10)) ||
    start.startsWith("0000") ||
    end.startsWith("0000") ||
    end <= start
  )
    return false;
  if (!timing.allDay) {
    if (typeof timing.timeZone !== "string" || !timing.timeZone) return false;
    try {
      zoneFormat(timing.timeZone);
    } catch {
      return false;
    }
  }
  return (
    recurrence === null ||
    (!!recurrence &&
      eventFrequencies.includes(recurrence.frequency) &&
      Number.isSafeInteger(recurrence.interval) &&
      recurrence.interval > 0 &&
      (recurrence.until === null ||
        (typeof recurrence.until === "string" &&
          isRoutineDate(recurrence.until) &&
          recurrence.until >= start.slice(0, 10))))
  );
}

function civilTime(value: string): number {
  return Date.parse(value.length === 10 ? value : value + "Z");
}

function offsetAt(instant: number, format: Intl.DateTimeFormat) {
  const parts = Object.fromEntries(
    format.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  const value = `${parts.year?.padStart(4, "0")}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`;
  return Date.parse(value) - instant;
}

function resolveStart(localTime: number, timeZone: string) {
  const format = zoneFormat(timeZone);
  const earlier = localTime - offsetAt(localTime - day, format);
  const later = localTime - offsetAt(localTime + day, format);
  const exact = [earlier, later].filter(
    (candidate) => candidate + offsetAt(candidate, format) === localTime,
  );
  // The first instant wins a fold. In a gap, the pre-transition offset
  // produces the later instant and shifts the occurrence by the gap length.
  return exact.length ? Math.min(...exact) : Math.max(earlier, later);
}

function* plannedStarts(
  anchor: number,
  from: number,
  to: number,
  recurrence: EventRecurrence | null,
) {
  if (!recurrence) {
    yield anchor;
    return;
  }
  if (recurrence.until) to = Math.min(to, civilTime(recurrence.until) + day);
  const { frequency, interval } = recurrence;
  if (frequency !== "monthly") {
    const step = interval * day * (frequency === "weekly" ? 7 : 1);
    const first = Math.max(0, Math.ceil((from - anchor) / step));
    for (let start = anchor + first * step; start < to; start += step)
      yield start;
    return;
  }

  const original = new Date(anchor);
  const lower = new Date(Math.max(from, anchor));
  const difference =
    (lower.getUTCFullYear() - original.getUTCFullYear()) * 12 +
    lower.getUTCMonth() -
    original.getUTCMonth();
  const first = Math.floor(difference / interval) * interval;
  for (let month = first; ; month += interval) {
    const candidate = new Date(anchor);
    candidate.setUTCMonth(original.getUTCMonth() + month);
    if (!Number.isFinite(+candidate) || +candidate >= to) return;
    if (candidate.getUTCDate() === original.getUTCDate() && +candidate >= from)
      yield +candidate;
  }
}

export function eventOccurrences(
  events: readonly CalendarEvent[],
  start: Date,
  end: Date,
  displayZone: string,
): EventOccurrence[] {
  if (!(+start < +end)) return [];
  const civilStart = civilTime(routineDate(+start, displayZone));
  // A partially visible end date still overlaps an all-day event.
  const lastCivilDate = civilTime(routineDate(+end - 1, displayZone));
  const occurrences: EventOccurrence[] = [];
  for (const event of events) {
    const { timing, recurrence } = event;
    const anchor = civilTime(timing.start);
    const plannedEnd = civilTime(timing.end);
    let duration = plannedEnd - anchor;
    if (!timing.allDay) {
      const resolved = resolveStart(anchor, timing.timeZone);
      const offset = offsetAt(resolved, zoneFormat(timing.timeZone));
      if (resolved + offset === anchor) {
        const elapsed = resolveStart(plannedEnd, timing.timeZone) - resolved;
        if (elapsed > 0) duration = elapsed;
      }
    }
    const from = timing.allDay ? civilStart : +start;
    const to = timing.allDay ? lastCivilDate + day : +end;
    // Offsets and a clock change can place the instant on another UTC day.
    const margin = timing.allDay ? 0 : 2 * day;
    for (const planned of plannedStarts(
      anchor,
      from - duration - margin,
      to + margin,
      recurrence,
    )) {
      const instant = timing.allDay
        ? planned
        : resolveStart(planned, timing.timeZone);
      if (instant >= to || instant + duration <= from) continue;
      const stamp = (value: number) => {
        const iso = new Date(value).toISOString();
        return timing.allDay ? iso.slice(0, 10) : iso;
      };
      const originalStart = new Date(planned)
        .toISOString()
        .slice(0, timing.allDay ? 10 : 16);
      occurrences.push({
        id: `${event.id}/${originalStart}`,
        event,
        originalStart,
        start: stamp(instant),
        end: stamp(instant + duration),
      });
    }
  }
  return occurrences;
}
