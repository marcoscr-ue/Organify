import type { Item, ItemChanges } from "@organify/core";

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
