import type { Item } from "@organify/core";

export function isOverdue(
  item: Pick<Item, "status" | "due" | "start" | "allDay" | "recurrence">,
  now: number,
): boolean {
  const date = item.due ?? (item.recurrence ? undefined : item.start);
  if (item.status === "done" || !date) return false;

  const deadline = new Date(date);
  if (!item.allDay) return deadline.getTime() < now;
  deadline.setHours(24, 0, 0, 0);
  return deadline.getTime() <= now;
}
