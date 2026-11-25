import FullCalendar from "@fullcalendar/react";
import type { EventInput } from "@fullcalendar/core";
import es from "@fullcalendar/core/locales/es";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import {
  eventOccurrences,
  taskDuration,
  type CalendarEvent,
  type EventOccurrence,
  type Id,
  type Item,
  type ItemChanges,
  type Project,
} from "@organify/core";
import {
  localStamp,
  scheduleChanges,
  shiftSeries,
  taskRecurrence,
} from "./calendar-schedule";
import { calendarZone } from "./events";

const plugins = [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin];
const views = {
  timeGridDay: "Día",
  timeGridWeek: "Semana",
  dayGridMonth: "Mes",
  listWeek: "Agenda",
};

export type CalendarPosition = { view: string; date: string };

function taskEvents(
  items: Item[],
  projects: ReadonlyMap<Id, Project>,
  start: Date,
  end: Date,
): EventInput[] {
  return items.flatMap((item) => {
    const date = item.start ?? item.due;
    if (!date) return [];
    const anchor = new Date(date);
    const minutes =
      item.start && !item.allDay
        ? taskDuration(item, "estimatedMinutes")
        : undefined;
    const duration = (minutes ?? 0) * 60_000;
    const eventEnd = (start: Date) => {
      if (!duration) return;
      const end = new Date(start.getTime() + duration);
      if (Number.isFinite(end.getTime())) return end;
    };
    const color = item.projectId
      ? projects.get(item.projectId)?.color
      : undefined;
    const event: EventInput = {
      title: item.title,
      allDay: item.allDay ?? false,
      extendedProps: { taskId: item.id },
      ...(color && {
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 20%, var(--paper))`,
        textColor: "var(--foreground)",
      }),
    };
    const prefix = localStamp(anchor);
    if (!item.recurrence) {
      return [
        {
          ...event,
          id: item.id,
          start: item.allDay ? prefix.slice(0, 10) : date,
          end: eventEnd(anchor),
        },
      ];
    }

    // rrule operates on UTC fields. Use local wall-clock values to keep a
    // recurring task at the same local time when daylight saving changes.
    const floating = (date: Date) => new Date(localStamp(date) + "Z");
    const rule = taskRecurrence(anchor, item.recurrence);
    // Include occurrences that start before the view and finish inside it.
    const earliest = new Date(
      Math.max(anchor.getTime(), start.getTime() - duration),
    );
    return rule
      .between(floating(earliest), floating(end), true)
      .map((occurrence) => {
        const local = occurrence.toISOString().slice(0, 19);
        return {
          ...event,
          id: `${item.id}/${local}`,
          start: item.allDay ? local.slice(0, 10) : local,
          end: eventEnd(new Date(local)),
        };
      });
  });
}

export function CalendarView({
  items,
  events,
  projects,
  open,
  openEvent,
  reschedule,
  position,
  onPositionChange,
  expanded = false,
}: {
  items: Item[];
  events: CalendarEvent[];
  projects: ReadonlyMap<Id, Project>;
  open: (id: Id) => void;
  openEvent: (occurrence: EventOccurrence) => void;
  reschedule: (id: Id, changes: ItemChanges) => Promise<boolean>;
  position?: CalendarPosition;
  onPositionChange?: (position: CalendarPosition) => void;
  expanded?: boolean;
}) {
  return (
    <section
      aria-label="Calendario de tareas y eventos"
      className={`organify-calendar min-w-0 overflow-x-auto rounded-lg border border-line p-2 sm:p-3 ${expanded ? "h-full" : ""}`}
    >
      <FullCalendar
        plugins={plugins}
        locale={es}
        timeZone="local"
        initialView={
          position && Object.hasOwn(views, position.view)
            ? position.view
            : "dayGridMonth"
        }
        initialDate={position?.date}
        datesSet={({ view }) =>
          onPositionChange?.({
            view: view.type,
            date: localStamp(view.calendar.getDate()).slice(0, 10),
          })
        }
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "timeGridDay,timeGridWeek,dayGridMonth,listWeek",
        }}
        buttonText={views}
        height={expanded ? "100%" : "auto"}
        expandRows={expanded}
        dayMaxEvents
        eventDisplay="block"
        eventStartEditable
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        events={({ start, end }, complete, fail) => {
          try {
            const commitments = eventOccurrences(
              events,
              start,
              end,
              calendarZone,
            ).map((occurrence): EventInput => {
              const { event } = occurrence;
              const color = event.color ?? "var(--accent-ink)";
              return {
                id: occurrence.id,
                title: event.title,
                allDay: event.timing.allDay,
                start: occurrence.start,
                end: occurrence.end,
                editable: false,
                startEditable: false,
                durationEditable: false,
                interactive: true,
                classNames: ["calendar-commitment"],
                borderColor: color,
                backgroundColor: `color-mix(in srgb, ${color} 18%, var(--paper))`,
                textColor: "var(--foreground)",
                extendedProps: { occurrence },
              };
            });
            complete([
              ...taskEvents(items, projects, start, end),
              ...commitments,
            ]);
          } catch (error) {
            fail(
              error instanceof Error
                ? error
                : new Error("No se pudieron cargar las recurrencias."),
            );
          }
        }}
        eventClick={({ event }) => {
          const taskId: unknown = event.extendedProps.taskId;
          if (typeof taskId === "string") open(taskId);
          const occurrence = event.extendedProps.occurrence as
            EventOccurrence | undefined;
          if (occurrence) openEvent(occurrence);
        }}
        eventDidMount={({ el, event, isMirror }) => {
          const taskId: unknown = event.extendedProps.taskId;
          if (!isMirror && typeof taskId === "string")
            el.dataset.taskShortcut = taskId;
        }}
        eventDrop={async ({ event, oldEvent, revert }) => {
          const item = items.find(
            ({ id }) => id === event.extendedProps.taskId,
          );
          const date = item?.start ?? item?.due;
          if (!item || !date || !event.start || !oldEvent.start) {
            revert();
            return;
          }
          const next = item.recurrence
            ? shiftSeries(new Date(date), oldEvent.start, event.start)
            : event.start;
          if (event.allDay) next.setHours(0, 0, 0, 0);
          if (
            !(await reschedule(
              item.id,
              scheduleChanges(item, next, event.allDay, item.recurrence),
            ))
          )
            revert();
        }}
      />
    </section>
  );
}
