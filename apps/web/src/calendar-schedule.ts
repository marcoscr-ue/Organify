import type { Item, ItemChanges } from "@organify/core";
import { rrulestr } from "rrule";

export const repeatOptions = [
  { value: "", label: "Sin repetición" },
  { value: "FREQ=DAILY", label: "Cada día" },
  { value: "FREQ=WEEKLY", label: "Cada semana" },
  { value: "FREQ=MONTHLY", label: "Cada mes" },
];

export function localStamp(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 19);
}

// Interpret the recurrence in local wall time, as in the calendar.
export function taskRecurrence(anchor: Date, recurrence: string) {
  const dtstart = localStamp(anchor).replace(/[-:]/g, "");
  return rrulestr(`DTSTART:${dtstart}\nRRULE:${recurrence}`);
}

export function latestTaskStart(item: Item, now: Date): string | undefined {
  if (!item.start || !item.recurrence || item.allDay || item.status === "done")
    return item.start;
  const anchor = new Date(item.start);
  if (!Number.isFinite(anchor.getTime()) || anchor > now) return item.start;
  try {
    const occurrence = taskRecurrence(anchor, item.recurrence).before(
      new Date(localStamp(now) + "Z"),
      true,
    );
    if (
      !occurrence ||
      occurrence.toISOString().slice(0, 19) === localStamp(anchor)
    )
      return item.start;
    return new Date(occurrence.toISOString().slice(0, 19)).toISOString();
  } catch {
    return item.start;
  }
}

export function scheduleChanges(
  item: Pick<Item, "start" | "due">,
  start: Date | undefined,
  allDay: boolean,
  recurrence?: string,
): ItemChanges {
  if (!start) {
    return {
      start: undefined,
      due: undefined,
      recurrence: undefined,
      allDay: undefined,
    };
  }

  return {
    [!item.start && item.due ? "due" : "start"]: start.toISOString(),
    allDay,
    recurrence: recurrence || undefined,
  };
}

export function shiftSeries(anchor: Date, from: Date, to: Date): Date {
  const stamp = (date: Date) => Date.parse(localStamp(date) + "Z");
  const shifted = new Date(stamp(anchor) + stamp(to) - stamp(from));
  return new Date(shifted.toISOString().slice(0, 19));
}
