import {
  eventOccurrences,
  eventReminderId,
  eventReminderTime,
  maxEventReminderMinutes,
  type CalendarEvent,
} from "@organify/core";

const day = 86_400_000;
const horizon = 30 * day;
export const eventReminderGrace = 12 * 60 * 60_000;

export function plannedEventReminders(
  events: readonly CalendarEvent[],
  now: number,
  displayZone: string,
) {
  const from = now - eventReminderGrace;
  const to = now + horizon;
  return eventOccurrences(
    events.filter(
      (event) =>
        event.reminderMinutes != null ||
        Object.values(event.exceptions ?? {}).some(
          ({ reminderMinutes }) => reminderMinutes != null,
        ),
    ),
    new Date(from),
    new Date(to + maxEventReminderMinutes * 60_000 + day),
    displayZone,
  )
    .flatMap((occurrence) => {
      const at = eventReminderTime(occurrence, displayZone);
      return at !== undefined && at >= from && at <= to
        ? [{ id: eventReminderId(occurrence), at }]
        : [];
    })
    .sort((a, b) => a.at - b.at);
}
