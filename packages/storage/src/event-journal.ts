import {
  isEventSchedule,
  isProjectColor,
  type CalendarEvent,
  type Replica,
} from "@organify/core";

export const eventIdPrefix = "event/";
export const eventKeyPrefix = "item:" + eventIdPrefix;

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
  };
}
