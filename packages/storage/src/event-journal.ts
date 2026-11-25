import {
  isEventSchedule,
  isProjectColor,
  type CalendarEvent,
  type EventException,
  type Replica,
} from "@organify/core";

export const eventIdPrefix = "event/";
export const eventKeyPrefix = "item:" + eventIdPrefix;
export const eventExceptionPrefix = "event:occurrence/";

function readExceptions(state: Replica): Record<string, EventException> {
  const exceptions = new Map<string, EventException>();
  for (const [key, { value }] of Object.entries(state.fields)) {
    if (!key.startsWith(eventExceptionPrefix)) continue;
    const [start, field] = key.slice(eventExceptionPrefix.length).split("/");
    if (!start || !field) continue;
    const change = exceptions.get(start) ?? {};
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
    exceptions.set(start, change);
  }
  return Object.fromEntries(exceptions);
}

export function readEvent(
  key: string,
  state: Replica,
): CalendarEvent | undefined {
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
    ...(schedule.recurrence && { exceptions: readExceptions(state) }),
  };
}
