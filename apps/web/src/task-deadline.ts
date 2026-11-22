import { taskDuration, type Item } from "@organify/core";

export function isOverdue(
  item: Pick<
    Item,
    "status" | "due" | "start" | "allDay" | "recurrence" | "props"
  >,
  now: number,
): boolean {
  const date = item.due ?? (item.recurrence ? undefined : item.start);
  if (item.status === "done" || !date) return false;

  const deadline = new Date(date);
  if (!item.allDay) {
    const minutes = item.due
      ? undefined
      : taskDuration(item, "estimatedMinutes");
    return deadline.getTime() + (minutes ?? 0) * 60_000 < now;
  }
  deadline.setHours(24, 0, 0, 0);
  return deadline.getTime() <= now;
}
