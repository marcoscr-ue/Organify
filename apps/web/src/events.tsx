import { useId, useLayoutEffect, useRef, useState } from "react";
import {
  eventFrequencies,
  eventOccurrences,
  shiftRoutineDate,
  type CalendarEvent,
  type EventInput,
  type EventOccurrence,
  type EventRecurrence,
} from "@organify/core";
import type { TaskRepositories } from "@organify/storage";
import { Button } from "@/components/ui/button";
import { CloseDialogButton } from "./app-overlays";
import { localStamp } from "./calendar-schedule";
import { InterfaceIcon } from "./interface-icon";
import {
  useWorkspaceShortcuts,
  type ShortcutBindings,
} from "./workspace-shortcuts";

const frequencies = { daily: "Diaria", weekly: "Semanal", monthly: "Mensual" };
export const calendarZone =
  Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
const monthLabel = new Intl.DateTimeFormat("es", {
  month: "long",
  year: "numeric",
});
const dayLabel = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeZone: "UTC",
});
const timeLabel = new Intl.DateTimeFormat("es", {
  dateStyle: "medium",
  timeStyle: "short",
});

export type EventDialogAction = { date?: string } | EventOccurrence;

function occurrenceLabel({ event, start, end }: EventOccurrence) {
  if (event.timing.allDay) {
    const last = shiftRoutineDate(end, -1);
    const label =
      start === last
        ? dayLabel.format(new Date(start))
        : dayLabel.formatRange(new Date(start), new Date(last));
    return `${label} · Todo el día`;
  }
  return timeLabel.formatRange(new Date(start), new Date(end));
}

export function EventsAgenda({
  events,
  create,
  open,
  bindings,
}: {
  events: CalendarEvent[];
  create: (date: string) => void;
  open: (occurrence: EventOccurrence) => void;
  bindings?: ShortcutBindings;
}) {
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  function shift(amount: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + amount, 1));
  }
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const today = new Date();
  const defaultDate = today >= month && today < end ? today : month;
  const createForMonth = () => create(localStamp(defaultDate).slice(0, 10));
  useWorkspaceShortcuts(bindings, (action) => {
    if (action !== "create") return;
    createForMonth();
    return true;
  });
  const occurrences = eventOccurrences(events, month, end, calendarZone).sort(
    (a, b) => {
      const instant = (value: string) =>
        Date.parse(value.length === 10 ? value + "T00:00" : value);
      return (
        instant(a.start) - instant(b.start) ||
        a.event.title.localeCompare(b.event.title, "es")
      );
    },
  );
  return (
    <section className="task-panel" aria-label="Agenda de eventos">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="topbar-button size-9"
            onClick={() => shift(-1)}
            aria-label="Mes anterior"
          >
            ‹
          </button>
          <h2
            className="min-w-28 text-center font-semibold first-letter:uppercase"
            aria-live="polite"
          >
            {monthLabel.format(month)}
          </h2>
          <button
            type="button"
            className="topbar-button size-9"
            onClick={() => shift(1)}
            aria-label="Mes siguiente"
          >
            ›
          </button>
        </div>
        <Button onClick={createForMonth}>Nuevo evento</Button>
      </div>
      {occurrences.length ? (
        <ul className="grid gap-2">
          {occurrences.map((occurrence) => (
            <li key={occurrence.id}>
              <button
                type="button"
                className="flex w-full items-center gap-3 rounded-md border border-line px-3 py-2.5 text-left hover:bg-tint focus-visible:outline-2 focus-visible:outline-primary"
                onClick={() => open(occurrence)}
              >
                <span
                  className="grid size-8 shrink-0 place-items-center rounded-md bg-tint text-accent-ink"
                  style={
                    occurrence.event.color
                      ? { boxShadow: `inset 3px 0 ${occurrence.event.color}` }
                      : undefined
                  }
                >
                  <InterfaceIcon name="calendar" />
                </span>
                <span className="grid min-w-0 gap-0.5">
                  <span className="wrap-anywhere font-medium">
                    {occurrence.event.title}
                  </span>
                  <span className="text-sm text-muted">
                    {occurrenceLabel(occurrence)}
                    {occurrence.event.recurrence
                      ? ` · ${frequencies[occurrence.event.recurrence.frequency]}`
                      : ""}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No hay eventos este mes.</p>
      )}
    </section>
  );
}

export function EventDialog({
  action,
  store,
  close,
}: {
  action: EventDialogAction;
  store: TaskRepositories["events"];
  close: () => void;
}) {
  const occurrence = "event" in action ? action : undefined;
  const date = "date" in action ? action.date : undefined;
  const original = occurrence?.event;
  const [mode, setMode] = useState(occurrence ? "detail" : "editor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    element?.querySelector<HTMLInputElement>("input[name=title]")?.focus();
    return () => element?.close();
  }, []);

  async function write(operation: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await operation();
      close();
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el evento.",
      );
    } finally {
      setBusy(false);
    }
  }

  function save(input: EventInput) {
    if (!original) return write(() => store.create(input));
    const { title, notes, color, timing } = input;
    return write(() =>
      store.update(original.id, {
        ...(title !== original.title && { title }),
        ...(notes !== original.notes && { notes }),
        ...(color !== original.color && { color }),
        ...(JSON.stringify(timing) !== JSON.stringify(original.timing) && {
          timing,
        }),
      }),
    );
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="routine-dialog"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) close();
      }}
    >
      <div className="routine-dialog-content">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="wrap-anywhere text-xl font-semibold">
            {mode === "editor"
              ? original
                ? "Editar evento"
                : "Nuevo evento"
              : original?.title}
          </h2>
          <CloseDialogButton onClick={close} disabled={busy} />
        </div>
        {mode === "editor" && (
          <EventEditor
            original={original}
            date={date}
            busy={busy}
            save={save}
          />
        )}
        {mode === "detail" && occurrence && (
          <div className="mt-3 grid gap-3">
            <p>{occurrenceLabel(occurrence)}</p>
            {!occurrence.event.timing.allDay &&
              occurrence.event.timing.timeZone !== calendarZone && (
                <p className="text-sm text-muted">
                  Zona del evento: {occurrence.event.timing.timeZone}
                </p>
              )}
            {occurrence.event.recurrence && (
              <p className="text-sm text-muted">
                Repetición{" "}
                {frequencies[
                  occurrence.event.recurrence.frequency
                ].toLocaleLowerCase("es")}
              </p>
            )}
            {occurrence.event.notes && (
              <p className="wrap-anywhere whitespace-pre-wrap">
                {occurrence.event.notes}
              </p>
            )}
            {!occurrence.event.recurrence && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setMode("editor")}>Editar</Button>
                <button
                  type="button"
                  className="topbar-button px-3 text-danger"
                  onClick={() => setMode("delete")}
                >
                  Borrar
                </button>
              </div>
            )}
          </div>
        )}
        {mode === "delete" && original && (
          <div className="mt-3 grid gap-3">
            <p>¿Quieres borrar este evento?</p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="topbar-button px-3"
                disabled={busy}
                onClick={() => {
                  setError("");
                  setMode("detail");
                }}
              >
                Volver
              </button>
              <Button
                className="bg-danger text-white hover:bg-danger/90"
                disabled={busy}
                onClick={() => void write(() => store.remove(original.id))}
              >
                Borrar evento
              </Button>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </dialog>
  );
}

function EventEditor({
  original,
  date,
  busy,
  save,
}: {
  original?: CalendarEvent;
  date?: string;
  busy: boolean;
  save: (input: EventInput) => Promise<void>;
}) {
  const [allDay, setAllDay] = useState(original?.timing.allDay ?? false);
  const [frequency, setFrequency] = useState<EventRecurrence["frequency"] | "">(
    "",
  );
  const [useColor, setUseColor] = useState(Boolean(original?.color));
  const [defaults] = useState(() => {
    const day = date ?? localStamp(new Date()).slice(0, 10);
    return { start: `${day}T09:00`, end: `${day}T10:00` };
  });
  const initial = original?.timing ?? defaults;
  const [startDate, setStartDate] = useState(initial.start.slice(0, 10));
  const [endDate, setEndDate] = useState(
    original?.timing.allDay
      ? shiftRoutineDate(initial.end, -1)
      : initial.end.slice(0, 10),
  );
  const [startTime, setStartTime] = useState(
    initial.start.slice(11) || "09:00",
  );
  const [endTime, setEndTime] = useState(initial.end.slice(11) || "10:00");
  const timeZone =
    original?.timing.allDay === false ? original.timing.timeZone : calendarZone;
  const field =
    "w-full rounded-md border border-line bg-paper px-2 py-1.5 text-foreground";

  return (
    <form
      className="mt-4 grid gap-3 text-sm"
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const text = (name: string) => String(values.get(name) ?? "");
        void save({
          title: text("title").trim(),
          notes: text("notes").trim(),
          color: useColor ? text("color") : null,
          timing: allDay
            ? {
                allDay: true,
                start: startDate,
                end: shiftRoutineDate(endDate, 1),
              }
            : {
                allDay: false,
                start: `${startDate}T${startTime}`,
                end: `${endDate}T${endTime}`,
                timeZone,
              },
          recurrence: frequency
            ? {
                frequency,
                interval: Number(text("interval")),
                until: text("until") || null,
              }
            : null,
        });
      }}
    >
      <fieldset className="grid min-w-0 gap-3" disabled={busy}>
        <label className="grid gap-1">
          Título
          <input
            required
            autoFocus
            name="title"
            defaultValue={original?.title}
            className={field}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allDay}
            onChange={(event) => setAllDay(event.target.checked)}
          />{" "}
          Todo el día
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1">
            Fecha de inicio
            <input
              required
              type="date"
              value={startDate}
              className={field}
              onChange={(event) => {
                const value = event.target.value;
                setStartDate(value);
                if (value > endDate) setEndDate(value);
              }}
            />
          </label>
          <label className="grid min-w-0 gap-1">
            {allDay ? "Último día" : "Fecha de fin"}
            <input
              required
              type="date"
              min={startDate}
              max={allDay ? "9999-12-30" : undefined}
              value={endDate}
              className={field}
              onChange={(event) => setEndDate(event.target.value)}
            />
          </label>
          {!allDay && (
            <>
              <label className="grid gap-1">
                Hora de inicio
                <input
                  required
                  type="time"
                  value={startTime}
                  className={field}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </label>
              <label className="grid gap-1">
                Hora de fin
                <input
                  required
                  type="time"
                  value={endTime}
                  className={field}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </label>
            </>
          )}
        </div>
        {!allDay && <p className="text-muted">Zona horaria: {timeZone}</p>}
        {!original && (
          <label className="grid gap-1">
            Repetición
            <select
              className={field}
              value={frequency}
              onChange={(event) => {
                const value = event.target.value;
                setFrequency(
                  eventFrequencies.find((entry) => entry === value) ?? "",
                );
              }}
            >
              <option value="">Sin repetición</option>
              {eventFrequencies.map((entry) => (
                <option key={entry} value={entry}>
                  {frequencies[entry]}
                </option>
              ))}
            </select>
          </label>
        )}
        {frequency && (
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1">
              {frequency === "daily"
                ? "Cada cuántos días"
                : frequency === "weekly"
                  ? "Cada cuántas semanas"
                  : "Cada cuántos meses"}
              <input
                required
                type="number"
                name="interval"
                min="1"
                step="1"
                defaultValue="1"
                className={field}
              />
            </label>
            <label className="grid gap-1">
              Última fecha (opcional)
              <input
                type="date"
                name="until"
                min={startDate}
                className={field}
              />
            </label>
          </div>
        )}
        {frequency === "monthly" && Number(startDate.slice(8)) > 28 && (
          <p className="text-muted">
            Se omitirán los meses que no tengan ese día.
          </p>
        )}
        <label className="grid gap-1">
          Notas (opcional)
          <textarea
            name="notes"
            rows={2}
            defaultValue={original?.notes}
            className={field}
          />
        </label>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useColor}
              onChange={(event) => setUseColor(event.target.checked)}
            />{" "}
            Color personalizado
          </label>
          {useColor && (
            <input
              type="color"
              name="color"
              defaultValue={original?.color ?? "#6355b7"}
              aria-label="Color del evento"
            />
          )}
        </div>
        <Button type="submit" className="justify-self-start">
          {busy ? "Guardando…" : "Guardar evento"}
        </Button>
      </fieldset>
    </form>
  );
}
