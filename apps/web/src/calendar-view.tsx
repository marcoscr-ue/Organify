import FullCalendar from "@fullcalendar/react";
import type { EventInput } from "@fullcalendar/core";
import es from "@fullcalendar/core/locales/es";
import dayGridPlugin from "@fullcalendar/daygrid";
import timeGridPlugin from "@fullcalendar/timegrid";
import listPlugin from "@fullcalendar/list";
import interactionPlugin from "@fullcalendar/interaction";
import { rrulestr } from "rrule";
import type { Id, Item, ItemChanges, Project } from "@organify/core";
import { localStamp, scheduleChanges, shiftSeries } from "./calendar-schedule";

const plugins = [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin];

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
    const color = item.projectId
      ? projects.get(item.projectId)?.color
      : undefined;
    const event: EventInput = {
      title: item.title,
      allDay: item.allDay ?? false,
      extendedProps: { taskId: item.id },
      ...(color && {
        borderColor: color,
        backgroundColor: `color-mix(in srgb, ${color} 20%, white)`,
        textColor: "#192338",
      }),
    };
    const prefix = localStamp(anchor);
    if (!item.recurrence) {
      return [
        {
          ...event,
          id: item.id,
          start: item.allDay ? prefix.slice(0, 10) : date,
        },
      ];
    }

    // rrule operates on UTC fields. Use local wall-clock values to keep a
    // recurring task at the same local time when daylight saving changes.
    const floating = (date: Date) => new Date(localStamp(date) + "Z");
    const dtstart = prefix.replace(/[-:]/g, "");
    const rule = rrulestr(`DTSTART:${dtstart}\nRRULE:${item.recurrence}`);
    return rule
      .between(floating(start), floating(end), true)
      .map((occurrence) => {
        const local = occurrence.toISOString().slice(0, 19);
        return {
          ...event,
          id: `${item.id}/${local}`,
          start: item.allDay ? local.slice(0, 10) : local,
        };
      });
  });
}

export function CalendarView({
  items,
  projects,
  open,
  reschedule,
}: {
  items: Item[];
  projects: ReadonlyMap<Id, Project>;
  open: (id: Id) => void;
  reschedule: (id: Id, changes: ItemChanges) => Promise<boolean>;
}) {
  return (
    <section
      aria-label="Calendario de tareas"
      className="organify-calendar min-w-0"
    >
      <FullCalendar
        plugins={plugins}
        locale={es}
        timeZone="local"
        initialView="dayGridMonth"
        headerToolbar={{
          left: "prev,next today",
          center: "title",
          right: "dayGridMonth,timeGridWeek,listWeek",
        }}
        height="auto"
        dayMaxEvents
        eventDisplay="block"
        eventStartEditable
        eventTimeFormat={{ hour: "2-digit", minute: "2-digit", hour12: false }}
        events={({ start, end }, complete, fail) => {
          try {
            complete(taskEvents(items, projects, start, end));
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
