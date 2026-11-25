import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import {
  eventOccurrenceForReminder,
  matchesInbox,
  taskDuration,
  taskDurationFields,
  type Id,
  type Inbox,
  type Item,
  type ItemChanges,
  type Project,
  type Status,
} from "@organify/core";
import {
  createTaskRepositories,
  type TaskRepositories,
  type TaskSnapshot,
} from "@organify/storage";
import { Button } from "@/components/ui/button";
import { Board } from "./board";
import { CalendarView, type CalendarPosition } from "./calendar-view";
import {
  AppControls,
  AutomaticReleaseNotes,
  CloseDialogButton,
  DeleteConfirmation,
  RenameDialog,
} from "./app-overlays";
import { BlockNotes } from "./block-notes";
import {
  DesktopWindowControls,
  FloatButton,
  desktopWindow,
  openFloatingView,
  readFloatingView,
} from "./desktop-windows";
import {
  cancelReminder,
  cancelReminders,
  isAndroid,
  isEventReminderId,
  reconcileEventReminders,
  reminderPermissionEvent,
  reminderTime,
  scheduleReminder,
  watchReminders,
} from "./reminders";
import { usePushState } from "./pwa-settings";
import {
  latestTaskStart,
  localStamp,
  repeatOptions,
  scheduleChanges,
} from "./calendar-schedule";
import { parseCapture } from "./quick-capture";
import {
  ProjectSelect,
  StatusSelect,
  statusLabels,
  TaskField,
  TaskStatusIcon,
} from "./task-controls";
import { ProjectNavigation } from "./project-navigation";
import { InterfaceIcon } from "./interface-icon";
import { RoutinesWorkspace } from "./routines";
import {
  calendarZone,
  EventDialog,
  EventsAgenda,
  type EventDialogAction,
} from "./events";
import { applyTheme, readDarkMode, themeStorageKey } from "./theme";
import { useTaskSwipe } from "./task-swipe";
import {
  useWorkspacePreferences,
  useWorkspaceShortcuts,
} from "./workspace-shortcuts";
import { useCompactNavigation, WorkspaceSidebar } from "./workspace-sidebar";
import { inboxes, useViewPreferences } from "./view-preferences";
import { useSharedWorkspaces, WorkspacePicker } from "./shared-workspaces";
import type { WorkspaceSession } from "./workspace-connection";

const personalRepositories = createTaskRepositories();
const inboxIcons = {
  all: "inbox",
  today: "sun",
  "in-progress": "clock",
  upcoming: "calendar",
  undated: "clock",
} as const;
const taskDurationLabels = {
  estimatedMinutes: "Duración estimada",
  spentMinutes: "Tiempo empleado",
};
const layouts = [
  { id: "list", label: "Lista", icon: "list" },
  { id: "board", label: "Tablero", icon: "board" },
  { id: "calendar", label: "Calendario", icon: "calendar" },
] as const;
type Layout = (typeof layouts)[number]["id"];
const weekday = new Intl.DateTimeFormat("es-ES", { weekday: "long" });
const month = new Intl.DateTimeFormat("es-ES", { month: "long" });

function formatToday(date: Date) {
  const day = weekday.format(date);
  return `${day.charAt(0).toLocaleUpperCase("es-ES")}${day.slice(1)}, ${date.getDate()} de ${month.format(date)}, ${date.getFullYear()}`;
}

function closeDisclosure(target: HTMLElement) {
  const disclosure = target.closest("details");
  disclosure?.querySelector("summary")?.focus();
  disclosure?.removeAttribute("open");
}

function dateLabel(
  item: Item,
  date = item.start ?? item.due,
): string | undefined {
  if (!date) return;
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: item.allDay ? undefined : "short",
  }).format(new Date(date));
}

function TaskDetail({
  item,
  documents,
  shared,
  projects,
  startEditing,
  save,
  remove,
  close,
  feedback,
  float,
  floating = false,
}: {
  item: Item;
  documents: TaskRepositories["documents"];
  shared: boolean;
  projects: Project[];
  startEditing: boolean;
  save: (changes: ItemChanges) => Promise<boolean>;
  remove: () => void;
  close: () => void;
  feedback: ReactNode;
  float?: () => void;
  floating?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const formId = useId();
  const titleInput = useRef<HTMLInputElement>(null);
  const dialogHeading = useRef<HTMLHeadingElement>(null);
  const drag = useRef<{
    pointerX: number;
    pointerY: number;
    x: number;
    y: number;
    bounds: DOMRect;
  }>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [editing, setEditing] = useState(startEditing);
  const [title, setTitle] = useState<string>();
  const [projectId, setProjectId] = useState<string>();
  const selectedTitle = title ?? item.title;
  const selectedProject = projectId ?? item.projectId ?? "";
  const scheduled = item.start ?? item.due;
  const local = scheduled ? localStamp(new Date(scheduled)) : "";
  const [date, setDate] = useState<string | undefined>();
  const [time, setTime] = useState<string | undefined>();
  const [recurrence, setRecurrence] = useState<string | undefined>();
  const [durationDraft, setDurationDraft] = useState<
    Partial<Record<(typeof taskDurationFields)[number], string>>
  >({});
  const selectedDate = date ?? local.slice(0, 10);
  const selectedTime = time ?? (item.allDay ? "" : local.slice(11, 16));
  const selectedRecurrence = recurrence ?? item.recurrence ?? "";
  const [saving, setSaving] = useState(false);
  const [reminderDraft, setReminderDraft] = useState<string>();
  const [reminderError, setReminderError] = useState("");
  const push = usePushState();
  const project = projects.find(({ id }) => id === item.projectId);
  const reminder = shared ? undefined : reminderTime(item.id);
  const currentReminder = reminder
    ? localStamp(new Date(reminder)).slice(0, 16)
    : "";

  useLayoutEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => modal?.close();
  }, []);

  useLayoutEffect(() => {
    if (editing) titleInput.current?.focus();
    else dialogHeading.current?.focus();
  }, [editing]);

  useEffect(() => {
    function resetPosition() {
      drag.current = null;
      setPosition({ x: 0, y: 0 });
    }
    window.addEventListener("resize", resetPosition);
    return () => window.removeEventListener("resize", resetPosition);
  }, []);

  useEffect(() => {
    if (!floating || !desktopWindow) return;
    let active = true;
    const subscription = window.__TAURI__?.event?.listen(
      "edit-task",
      () => {
        if (active) setEditing(true);
      },
      { target: desktopWindow.label },
    );
    void subscription?.catch(console.error);
    return () => {
      active = false;
      void subscription?.then((unlisten) => unlisten()).catch(console.error);
    };
  }, [floating]);

  function moveDialog(event: PointerEvent<HTMLDivElement>) {
    const origin = drag.current;
    if (!origin) return;
    const { bounds } = origin;
    const dx = Math.max(
      8 - bounds.left,
      Math.min(
        window.innerWidth - 8 - bounds.right,
        event.clientX - origin.pointerX,
      ),
    );
    const dy = Math.max(
      8 - bounds.top,
      Math.min(
        window.innerHeight - 8 - bounds.bottom,
        event.clientY - origin.pointerY,
      ),
    );
    setPosition({ x: origin.x + dx, y: origin.y + dy });
  }

  function changeMode(next: boolean) {
    setTitle(undefined);
    setProjectId(undefined);
    setDate(undefined);
    setTime(undefined);
    setRecurrence(undefined);
    setDurationDraft({});
    setReminderDraft(undefined);
    setReminderError("");
    setPosition({ x: 0, y: 0 });
    setEditing(next);
  }

  function dismiss() {
    if (!floating) dialog.current?.close();
    close();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setReminderError("");
    const reminderChanged =
      reminderDraft !== undefined && reminderDraft !== currentReminder;
    const reminderAt = reminderDraft
      ? new Date(reminderDraft).getTime()
      : undefined;
    if (
      reminderChanged &&
      reminderAt !== undefined &&
      (!Number.isFinite(reminderAt) || reminderAt <= Date.now())
    ) {
      setReminderError("Elige una fecha y hora futuras para el recordatorio.");
      return;
    }
    setSaving(true);
    try {
      const dateOrTimeEdited = date !== undefined || time !== undefined;
      const start = selectedDate
        ? new Date(selectedDate + "T" + (selectedTime || "00:00"))
        : undefined;
      const schedule = dateOrTimeEdited
        ? scheduleChanges(item, start, !selectedTime, selectedRecurrence)
        : recurrence !== undefined
          ? { recurrence: selectedRecurrence || undefined }
          : {};
      const durations: ItemChanges = {};
      for (const field of taskDurationFields) {
        const value = durationDraft[field];
        if (value !== undefined)
          durations[field] = value ? Number(value) : undefined;
      }
      if (
        !(await save({
          ...(title !== undefined && { title }),
          ...(projectId !== undefined && { projectId: projectId || undefined }),
          ...schedule,
          ...durations,
        }))
      )
        return;
      if (reminderChanged) {
        try {
          if (reminderAt === undefined) await cancelReminder(item.id);
          else await scheduleReminder(item.id, reminderAt);
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "No se pudo guardar el recordatorio.";
          setReminderError(
            `La tarea se guardó, pero el recordatorio no se pudo actualizar. ${message}`,
          );
          return;
        }
      }
      setPosition({ x: 0, y: 0 });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
      className={
        floating
          ? "m-0 h-dvh max-h-none w-full max-w-none overflow-y-auto bg-paper text-foreground"
          : "m-auto max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-line bg-paper text-foreground shadow-xl backdrop:bg-black/35"
      }
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) dismiss();
      }}
    >
      <div
        className={`sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-line bg-paper px-5 py-4 ${floating ? "" : "sm:cursor-grab sm:select-none"}`}
        onPointerDown={(event) => {
          if (
            floating ||
            event.pointerType !== "mouse" ||
            event.button !== 0 ||
            (event.target as Element).closest("button")
          )
            return;
          const bounds = dialog.current?.getBoundingClientRect();
          if (!bounds) return;
          drag.current = {
            ...position,
            bounds,
            pointerX: event.clientX,
            pointerY: event.clientY,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={moveDialog}
        onLostPointerCapture={() => {
          drag.current = null;
        }}
      >
        <div className="min-w-0">
          <h2
            ref={dialogHeading}
            tabIndex={-1}
            id={titleId}
            className="text-xl font-semibold wrap-anywhere outline-none"
          >
            {editing ? "Editar tarea" : item.title}
          </h2>
          {!editing && (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted">
              {project && (
                <span className="project-tag">
                  <span
                    aria-hidden="true"
                    className="project-dot"
                    style={{ backgroundColor: project.color }}
                  />
                  {project.name}
                </span>
              )}
              {scheduled && (
                <span className="inline-flex items-center gap-1">
                  <InterfaceIcon name="calendar" />
                  {dateLabel(item)}
                </span>
              )}
              <span>{statusLabels[item.status]}</span>
              {taskDurationFields.map((field) => {
                const minutes = taskDuration(item, field);
                return minutes === undefined ? null : (
                  <span key={field} className="inline-flex items-center gap-1">
                    <InterfaceIcon name="clock" />
                    {taskDurationLabels[field]}: {minutes} min
                  </span>
                );
              })}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!editing && float && (
            <FloatButton
              label="Abrir tarea en una ventana independiente"
              onClick={float}
            />
          )}
          {!floating && (
            <CloseDialogButton onClick={dismiss} disabled={saving} />
          )}
        </div>
      </div>
      <div className="p-5">
        {feedback}
        {editing && (
          <form
            id={formId}
            className="grid grid-cols-1 gap-3 sm:grid-cols-2"
            onSubmit={submit}
          >
            <TaskField
              label="Título"
              resetLabel="Restaurar título guardado"
              onReset={() => setTitle(undefined)}
              disabled={selectedTitle === item.title || saving}
              className="sm:col-span-2"
            >
              <input
                ref={titleInput}
                className="field"
                value={selectedTitle}
                required
                onChange={(event) => setTitle(event.target.value)}
              />
            </TaskField>
            <TaskField
              label="Proyecto"
              resetLabel="Quitar proyecto"
              onReset={() => setProjectId("")}
              disabled={!selectedProject || saving}
            >
              <ProjectSelect
                value={selectedProject}
                onChange={setProjectId}
                projects={projects}
              />
            </TaskField>
            <TaskField
              label="Fecha"
              resetLabel="Quitar fecha"
              onReset={() => {
                setDate("");
                setTime("");
                setRecurrence("");
              }}
              disabled={!selectedDate || saving}
            >
              <input
                type="date"
                className="field min-w-0"
                value={selectedDate}
                onChange={(event) => setDate(event.target.value)}
              />
            </TaskField>
            <TaskField
              label="Hora (opcional)"
              resetLabel="Quitar hora"
              onReset={() => setTime("")}
              disabled={!selectedDate || !selectedTime || saving}
            >
              <input
                type="time"
                className="field min-w-0"
                value={selectedDate ? selectedTime : ""}
                disabled={!selectedDate}
                onChange={(event) => setTime(event.target.value)}
              />
            </TaskField>
            <TaskField
              label="Repetición"
              resetLabel="Quitar repetición"
              onReset={() => setRecurrence("")}
              disabled={!selectedDate || !selectedRecurrence || saving}
            >
              <select
                className="field min-w-0"
                disabled={!selectedDate}
                value={selectedDate ? selectedRecurrence : ""}
                onChange={(event) => setRecurrence(event.target.value)}
              >
                {repeatOptions.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </TaskField>
            {selectedDate && selectedRecurrence && (
              <p className="text-sm text-muted sm:col-span-2">
                Los cambios se aplican a toda la serie.
              </p>
            )}
            {taskDurationFields.map((field) => {
              const value =
                durationDraft[field] ?? taskDuration(item, field) ?? "";
              const change = (value: string) =>
                setDurationDraft((draft) => ({ ...draft, [field]: value }));
              return (
                <TaskField
                  key={field}
                  label={taskDurationLabels[field] + " (min)"}
                  resetLabel={`Quitar ${taskDurationLabels[field].toLowerCase()}`}
                  disabled={value === "" || saving}
                  onReset={() => change("")}
                >
                  <input
                    type="number"
                    inputMode="numeric"
                    className="field min-w-0"
                    min={field === "estimatedMinutes" ? 1 : 0}
                    max={Number.MAX_SAFE_INTEGER}
                    step={1}
                    value={value}
                    disabled={saving}
                    onChange={(event) => change(event.target.value)}
                  />
                </TaskField>
              );
            })}
          </form>
        )}
        <BlockNotes
          id={item.id}
          legacy={item.notes}
          documents={documents}
          editable={editing}
        />
        {!shared &&
          (editing ? (
            <div className="mt-4 grid gap-2 border-t border-line pt-4 text-sm">
              <TaskField
                label="Recordatorio en este dispositivo"
                resetLabel="Quitar recordatorio"
                disabled={!(reminderDraft ?? currentReminder) || saving}
                onReset={() => {
                  setReminderDraft("");
                  setReminderError("");
                }}
              >
                <input
                  className="field min-w-0"
                  type="datetime-local"
                  form={formId}
                  value={reminderDraft ?? currentReminder}
                  onChange={(event) => setReminderDraft(event.target.value)}
                  disabled={saving}
                />
              </TaskField>
              <p className="text-muted">
                {isAndroid
                  ? "Android puede retrasar el aviso para ahorrar batería."
                  : push.enabled
                    ? "Recibirás el aviso aunque cierres la aplicación."
                    : push.availability === "native"
                      ? "Mantén la aplicación abierta para recibir el aviso."
                      : "Mantén la aplicación abierta para recibir el aviso o activa los avisos con la app cerrada en Ajustes."}
              </p>
              {reminderError && (
                <p role="alert" className="text-danger">
                  {reminderError}
                </p>
              )}
            </div>
          ) : (
            reminder !== undefined && (
              <p className="mt-3 flex items-center gap-2 rounded-md bg-panel p-3 text-sm text-muted">
                <InterfaceIcon name="clock" className="size-4 shrink-0" />
                Recordatorio en este dispositivo:{" "}
                {new Date(reminder).toLocaleString("es")}
              </p>
            )
          ))}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-4">
          {editing ? (
            <>
              <button
                type="button"
                className="nav-link"
                disabled={saving}
                onClick={() => changeMode(false)}
              >
                Cancelar
              </button>
              <Button
                key="save"
                className="gap-1.5"
                type="submit"
                form={formId}
                disabled={saving}
              >
                <InterfaceIcon name="save" />
                Guardar
              </Button>
            </>
          ) : (
            <>
              <button type="button" className="nav-link" onClick={dismiss}>
                Cerrar
              </button>
              <Button
                key="edit"
                type="button"
                className="gap-1.5"
                onClick={(event) => {
                  event.preventDefault();
                  changeMode(true);
                }}
              >
                <InterfaceIcon name="edit" />
                Editar tarea
              </Button>
              <Button
                type="button"
                className="gap-1.5 bg-danger-button text-white hover:bg-danger-button/90"
                onClick={remove}
              >
                <InterfaceIcon name="trash" />
                Eliminar
              </Button>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}

export function App() {
  const [floating] = useState(readFloatingView);
  const [workspaceSession, setWorkspaceSession] = useState<WorkspaceSession>();
  const sharedWorkspaces = useSharedWorkspaces(workspaceSession);
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>();
  const space = sharedWorkspaces.spaces.find(
    ({ id }) => id === selectedSpaceId,
  );
  const repositories = space?.repositories ?? personalRepositories;
  const preferences = useWorkspacePreferences();
  const viewPreferences = useViewPreferences();
  const { startupView } = viewPreferences;
  const bindings = preferences.keyboardShortcuts
    ? preferences.bindings
    : undefined;
  const compactNavigation = useCompactNavigation();
  const navigation = useRef<HTMLDialogElement>(null);
  const [openingView, setOpeningView] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [darkMode, setDarkMode] = useState(readDarkMode);
  const [section, setSection] = useState<"tasks" | "routines" | "events">(
    !floating && (startupView === "routines" || startupView === "events")
      ? startupView
      : "tasks",
  );
  const [eventAction, setEventAction] = useState<EventDialogAction>();
  const showRoutines = section === "routines";
  const showEvents = section === "events";
  const [tasksOpen, setTasksOpen] = useState(true);
  const [deletion, setDeletion] = useState<{ item: Item } | { ids: Id[] }>();
  const [renameId, setRenameId] = useState<Id>();
  const calendarPosition = useRef<CalendarPosition>(undefined);
  const [personalSnapshot, setPersonalSnapshot] = useState<TaskSnapshot>();
  const [personalReadError, setPersonalReadError] = useState(false);
  const [sharedRead, setSharedRead] = useState<{
    repositories: TaskRepositories;
    snapshot?: TaskSnapshot;
    error?: boolean;
  }>();
  const snapshot = space
    ? sharedRead?.repositories === repositories
      ? sharedRead.snapshot
      : undefined
    : personalSnapshot;
  const readError = space
    ? sharedRead?.repositories === repositories && sharedRead.error
    : personalReadError;
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const floatingTasks = floating?.kind !== "task" ? floating : undefined;
  const [inbox, setInbox] = useState<Inbox>(
    floatingTasks?.inbox ??
      inboxes.find(({ id }) => id === startupView)?.id ??
      (startupView === "board" || startupView === "calendar" ? "all" : "today"),
  );
  const [projectId, setProjectId] = useState<Id | undefined>(
    floatingTasks?.projectId,
  );
  const [layout, setLayout] = useState<Layout>(
    floatingTasks?.kind ??
      (startupView === "board" || startupView === "calendar"
        ? startupView
        : "list"),
  );
  const [selectedId, setSelectedId] = useState<Id | undefined>(
    floating?.kind === "task" ? floating.id : undefined,
  );
  const [startEditing, setStartEditing] = useState(
    floating?.kind === "task" && floating.edit,
  );
  const [now, setNow] = useState(Date.now);
  const [input, setInput] = useState("");
  const [projectName, setProjectName] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [floatingCaptureOpen, setFloatingCaptureOpen] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectCreationFailed, setProjectCreationFailed] = useState(false);
  const [taskSearch, setTaskSearch] = useState(floatingTasks?.search ?? "");
  const [statusFilter, setStatusFilter] = useState<Status | undefined>(
    floatingTasks?.status,
  );
  const [query, setQuery] = useState("");
  const [reminderAlert, setReminderAlert] = useState<Id>();
  const [eventReminderToOpen, setEventReminderToOpen] = useState<Id>();
  const scheduledEvents = personalSnapshot?.events;
  const capture = useRef<HTMLInputElement>(null);
  const palette = useRef<HTMLDialogElement>(null);

  useEffect(
    () =>
      personalRepositories.subscribe(setPersonalSnapshot, () =>
        setPersonalReadError(true),
      ),
    [],
  );

  useEffect(() => {
    if (repositories === personalRepositories) return;
    return repositories.subscribe(
      (snapshot) => setSharedRead({ repositories, snapshot }),
      () => setSharedRead({ repositories, error: true }),
    );
  }, [repositories]);

  useEffect(() => {
    if (selectedSpaceId && !space) {
      changeWorkspace();
    }
  }, [selectedSpaceId, space]);

  useEffect(() => {
    function syncTheme(event: StorageEvent) {
      if (event.key !== themeStorageKey && event.key !== null) return;
      const dark = readDarkMode();
      applyTheme(dark);
      setDarkMode(dark);
    }
    window.addEventListener("storage", syncTheme);
    return () => window.removeEventListener("storage", syncTheme);
  }, []);

  function changeTheme(dark: boolean) {
    localStorage.setItem(themeStorageKey, dark ? "dark" : "light");
    applyTheme(dark);
    setDarkMode(dark);
  }

  useEffect(() => {
    if (!floating)
      return watchReminders(setReminderAlert, (id) => {
        if (space) changeWorkspace();
        if (isEventReminderId(id)) {
          setEventReminderToOpen(id);
          return;
        }
        setStartEditing(false);
        setSelectedId(id);
      });
  }, [floating, space]);
  useEffect(() => {
    if (floating || !scheduledEvents) return;
    const events = scheduledEvents;
    const refresh = () => {
      void reconcileEventReminders(events, calendarZone).catch(
        (error: unknown) =>
          console.error(
            "No se pudieron actualizar los recordatorios de eventos.",
            error,
          ),
      );
    };
    refresh();
    const timer = window.setInterval(refresh, 15 * 60_000);
    window.addEventListener("focus", refresh);
    window.addEventListener(reminderPermissionEvent, refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener(reminderPermissionEvent, refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [floating, scheduledEvents]);
  useEffect(() => {
    if (!eventReminderToOpen || !scheduledEvents) return;
    setSection("events");
    setSelectedId(undefined);
    setEventAction(
      eventOccurrenceForReminder(scheduledEvents, eventReminderToOpen),
    );
    setEventReminderToOpen(undefined);
  }, [eventReminderToOpen, scheduledEvents]);
  useEffect(() => {
    if (floating?.kind === "task") return;
    const refreshClock = () => setNow(Date.now());
    const clock = window.setInterval(refreshClock, 15_000);
    document.addEventListener("visibilitychange", refreshClock);
    return () => {
      window.clearInterval(clock);
      document.removeEventListener("visibilitychange", refreshClock);
    };
  }, [floating]);
  function openPalette() {
    if (!document.querySelector("dialog[open]")) {
      setQuery("");
      palette.current?.showModal();
    }
  }

  useEffect(() => {
    if (floating) return;
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [floating]);

  function navigate(nextInbox: Inbox, nextProject?: Id) {
    navigation.current?.close();
    setSection("tasks");
    if (!nextProject) setTasksOpen(true);
    if (layout === "calendar" && nextInbox !== "all") setLayout("list");
    setInbox(nextInbox);
    setTaskSearch("");
    setStatusFilter(undefined);
    setProjectId(nextProject);
    setSelectedId(undefined);
  }

  function changeWorkspace(id?: string) {
    setSelectedSpaceId(id);
    setProjectId(undefined);
    setInbox("all");
    setSection("tasks");
    setSelectedId(undefined);
    setEventAction(undefined);
    setDeletion(undefined);
    setRenameId(undefined);
    setTaskSearch("");
    setStatusFilter(undefined);
    setInput("");
    setProjectName("");
    setProjectCreationFailed(false);
    setError("");
    setNotice("");
  }

  function openRoutines() {
    navigation.current?.close();
    setSection("routines");
    setSelectedId(undefined);
  }

  function openEvents() {
    navigation.current?.close();
    setSection("events");
    setSelectedId(undefined);
  }

  async function openTask(id: Id, edit = false, title?: string) {
    setNotice("");
    setError("");
    if (
      !space &&
      desktopWindow &&
      viewPreferences.tasksInWindows &&
      floating?.kind !== "task"
    ) {
      try {
        await openFloatingView(
          { kind: "task", id, edit },
          title ?? snapshot?.items.find((item) => item.id === id)?.title,
        );
        return;
      } catch {
        setError("No se pudo abrir la tarea en una ventana independiente.");
      }
    }
    setStartEditing(edit);
    setSelectedId(id);
  }

  async function confirmDeletion(target: NonNullable<typeof deletion>) {
    const ids = "item" in target ? [target.item.id] : target.ids;
    await repositories.items.removeMany(ids);

    setError("");
    setNotice("item" in target ? "Tarea eliminada." : "Tareas eliminadas.");
    let remindersCancelled = true;
    try {
      if (!space) await cancelReminders(ids);
    } catch {
      remindersCancelled = false;
      setError(
        "Se completó el borrado, pero no se pudieron cancelar los recordatorios en este dispositivo.",
      );
    }
    setSelectedId((id) => (id && ids.includes(id) ? undefined : id));
    setDeletion(undefined);
    if (remindersCancelled && floating?.kind === "task")
      void closeFloatingTask();
  }

  async function closeFloatingTask() {
    try {
      await desktopWindow?.close();
    } catch {
      setError("No se pudo cerrar la ventana.");
    }
  }

  async function floatTask(item: Item, fromDetail = false) {
    const opened = await write(
      () =>
        openFloatingView(
          { kind: "task", id: item.id, edit: false },
          item.title,
        ),
      "",
    );
    if (opened && fromDetail) {
      setSelectedId((id) => (id === item.id ? undefined : id));
    }
  }

  async function write(
    operation: () => Promise<unknown>,
    success: string,
  ): Promise<boolean> {
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(success);
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo guardar el cambio.",
      );
      return false;
    }
  }

  async function captureTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (capturing || !input.trim()) return;
    setCapturing(true);
    const created = await write(async () => {
      const task = parseCapture(input);
      const id = await repositories.items.create({
        ...task,
        projectId,
      });
      if (!floatingTasks) setInbox("all");
      await openTask(id, true, task.title);
    }, "Tarea creada.");
    if (created) {
      setInput("");
      setFloatingCaptureOpen(false);
    }
    setCapturing(false);
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingProject || !projectName.trim()) return;
    setCreatingProject(true);
    setProjectCreationFailed(false);
    const created = await write(async () => {
      navigate("all", await repositories.projects.create(projectName));
    }, "Proyecto creado.");
    if (created) setProjectName("");
    else setProjectCreationFailed(true);
    setCreatingProject(false);
  }

  function move(id: Id, status: Status) {
    void write(
      () => repositories.items.move(id, status),
      "Estado actualizado.",
    );
  }

  const projects = snapshot?.projects ?? [];
  const selected = snapshot?.items.find((item) => item.id === selectedId);
  const eventAlert = Boolean(reminderAlert && isEventReminderId(reminderAlert));
  const reminderTitle = eventAlert
    ? eventOccurrenceForReminder(scheduledEvents ?? [], reminderAlert!)?.event
        .title
    : personalSnapshot?.items.find((item) => item.id === reminderAlert)?.title;
  const today = new Date(now);
  const todayItems =
    snapshot?.items.filter((item) => matchesInbox(item, "today", today)) ?? [];
  const doneToday = todayItems.filter((item) => item.status === "done").length;
  const activeInbox = layout === "calendar" ? "all" : inbox;
  const visible =
    snapshot?.items.filter(
      (item) =>
        (!projectId || item.projectId === projectId) &&
        (!statusFilter || item.status === statusFilter) &&
        item.title
          .toLocaleLowerCase("es")
          .includes(taskSearch.trim().toLocaleLowerCase("es")) &&
        matchesInbox(
          item,
          activeInbox,
          today,
          activeInbox === "in-progress" &&
            taskDuration(item, "estimatedMinutes")
            ? latestTaskStart(item, today)
            : item.start,
        ),
    ) ?? [];
  const swipeEnabled = preferences.mobile && preferences.swipeToDelete;
  const swipeHandlers = useTaskSwipe(swipeEnabled, (id) => {
    const item = visible.find((item) => item.id === id);
    if (item) setDeletion({ item });
  });
  useWorkspaceShortcuts(bindings, (action) => {
    if (!snapshot || floating?.kind === "task" || section !== "tasks") return;
    if (action === "create") {
      if (floatingTasks) setFloatingCaptureOpen(true);
      requestAnimationFrame(() => capture.current?.focus());
      return true;
    }
    const hovered = document.querySelector<HTMLElement>(
      "[data-task-shortcut]:hover",
    );
    const item = visible.find(
      (item) => item.id === hovered?.dataset.taskShortcut,
    );
    if (!item) return;
    if (action === "edit") openTask(item.id, true);
    if (action === "rename") setRenameId(item.id);
    if (action === "delete") setDeletion({ item });
    return true;
  });
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const heading = showEvents
    ? "Eventos"
    : showRoutines
      ? "Rutinas"
      : projectId
        ? projectById.get(projectId)?.name
        : inboxes.find(({ id }) => id === activeInbox)?.label;
  const isToday = section === "tasks" && !projectId && activeInbox === "today";
  const openCount = visible.filter((item) => item.status !== "done").length;
  const allCommands: { label: string; run: () => void; disabled?: boolean }[] =
    [
      {
        label: "Capturar tarea",
        run: () => {
          setSection("tasks");
          requestAnimationFrame(() => capture.current?.focus());
        },
      },
      {
        label: "Alternar modo claro y oscuro",
        run: () => changeTheme(!darkMode),
      },
      ...layouts.map(({ id, label }) => ({
        label: `Abrir ${label.toLocaleLowerCase("es")}`,
        run: () => {
          setSection("tasks");
          setLayout(id);
        },
      })),
      ...inboxes.map(({ id, label }) => ({
        label: `Ir a ${label}`,
        run: () => navigate(id),
      })),
      ...(!space
        ? [
            { label: "Ir a Rutinas", run: openRoutines },
            { label: "Ir a Eventos", run: openEvents },
          ]
        : []),
      ...projects.map(({ id, name }) => ({
        label: `Abrir proyecto ${name}`,
        run: () => navigate("all", id),
      })),
      {
        label: "Borrar todas las tareas",
        run: () => {
          if (!snapshot) return;
          if (snapshot.items.length) {
            setDeletion({ ids: snapshot.items.map(({ id }) => id) });
          } else {
            setError("");
            setNotice("No hay tareas que borrar.");
          }
        },
        disabled: !snapshot,
      },
    ];
  const commands = allCommands.filter(({ label }) =>
    label
      .toLocaleLowerCase("es")
      .includes(query.trim().toLocaleLowerCase("es")),
  );

  const feedback = (
    <>
      <p role="status" className="mb-3 text-sm text-muted empty:hidden">
        {notice}
      </p>
      {error && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {error}
        </p>
      )}
    </>
  );

  async function floatLayout() {
    if (openingView || (layout !== "board" && layout !== "calendar")) return;
    setOpeningView(true);
    try {
      await write(
        () =>
          openFloatingView({
            kind: layout,
            inbox: activeInbox,
            projectId,
            status: statusFilter,
            search: taskSearch,
            position:
              layout === "calendar" ? calendarPosition.current : undefined,
          }),
        "",
      );
    } finally {
      setOpeningView(false);
    }
  }

  const taskDetail = selected && (
    <TaskDetail
      key={selected.id}
      item={selected}
      documents={repositories.documents}
      shared={Boolean(space)}
      projects={projects}
      startEditing={startEditing}
      feedback={feedback}
      save={(changes) =>
        write(
          () => repositories.items.update(selected.id, changes),
          "Tarea guardada.",
        )
      }
      remove={() => setDeletion({ item: selected })}
      close={() => {
        if (floating?.kind === "task") void closeFloatingTask();
        else setSelectedId(undefined);
      }}
      floating={floating?.kind === "task"}
      float={
        !space && desktopWindow && floating?.kind !== "task"
          ? () => void floatTask(selected, true)
          : undefined
      }
    />
  );

  const deleteConfirmation = deletion && (
    <DeleteConfirmation
      title={
        "item" in deletion ? "¿Eliminar tarea?" : "¿Borrar todas las tareas?"
      }
      confirmLabel={
        "item" in deletion ? "Eliminar tarea" : "Borrar todas las tareas"
      }
      onCancel={() => setDeletion(undefined)}
      onConfirm={() => confirmDeletion(deletion)}
    >
      {"item" in deletion
        ? `Se eliminará «${deletion.item.title}». El cambio se propagará a los dispositivos sincronizados.`
        : `Se borrarán ${deletion.ids.length === 1 ? "1 tarea" : `${deletion.ids.length} tareas`} de todo el espacio de trabajo, incluidas las de otros proyectos. El cambio se propagará a los dispositivos sincronizados.`}
    </DeleteConfirmation>
  );
  const renameItem = snapshot?.items.find((item) => item.id === renameId);
  const renameDialog = renameItem && (
    <RenameDialog
      key={renameItem.id}
      title="Renombrar tarea"
      name={renameItem.title}
      close={() => setRenameId(undefined)}
      save={async (title) => {
        await repositories.items.update(renameItem.id, { title });
        setError("");
        setNotice("Tarea renombrada.");
      }}
    />
  );

  const quickCapture = (
    <form className="quick-add" onSubmit={captureTask}>
      <InterfaceIcon name="plus" className="size-5 shrink-0" />
      <input
        ref={capture}
        className="min-w-0 flex-1 text-sm text-foreground outline-none placeholder:text-muted"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        placeholder="Ejemplo: Reunión con Ana mañana a las 10:00"
        aria-label="Captura rápida"
        required
      />
      <Button
        className="h-8 px-2.5 text-xs"
        type="submit"
        disabled={!snapshot || capturing}
      >
        Añadir
      </Button>
    </form>
  );

  const viewLoading = readError ? (
    <p role="alert" className="text-sm text-danger">
      No se pudieron leer las tareas guardadas.
    </p>
  ) : (
    !snapshot && <p className="text-sm text-muted">Cargando tareas…</p>
  );

  const boardOrCalendar = snapshot && (
    <>
      {layout === "board" && (
        <Board
          items={visible}
          projects={projectById}
          now={now}
          open={openTask}
          move={move}
          expanded={expanded}
        />
      )}
      {layout === "calendar" && (
        <CalendarView
          items={visible}
          events={snapshot.events}
          projects={projectById}
          open={openTask}
          openEvent={setEventAction}
          rescheduleOccurrence={(occurrence, timing) =>
            write(
              () =>
                repositories.events.updateOccurrence(
                  occurrence.event.id,
                  occurrence.originalStart,
                  { timing },
                ),
              "Se ha movido solo este evento.",
            )
          }
          reschedule={(id, changes) =>
            write(
              () => repositories.items.update(id, changes),
              "Tarea reprogramada.",
            )
          }
          position={floatingTasks?.position}
          expanded={expanded}
          onPositionChange={(position) => {
            calendarPosition.current = position;
          }}
        />
      )}
    </>
  );

  const eventDialog = eventAction && (
    <EventDialog
      action={eventAction}
      store={repositories.events}
      close={() => setEventAction(undefined)}
    />
  );

  if (floating?.kind === "task") {
    return (
      <>
        {taskDetail ?? (
          <main className="p-5">
            {feedback}
            {viewLoading}
            {snapshot && !readError && (
              <p className="text-sm text-muted">
                Esta tarea ya no está disponible.
              </p>
            )}
          </main>
        )}
        {deleteConfirmation}
      </>
    );
  }

  if (floatingTasks) {
    return (
      <main
        className={`flex flex-col gap-3 p-4 ${expanded ? "h-dvh" : "min-h-svh"}`}
      >
        <header className="flex shrink-0 flex-wrap items-center justify-between gap-2">
          <h1 className="min-w-0 text-lg font-semibold wrap-anywhere">
            {heading ??
              (floatingTasks.kind === "board" ? "Tablero" : "Calendario")}
          </h1>
          <button
            type="button"
            className="topbar-button gap-1.5 px-2.5"
            onClick={() => setExpanded(!expanded)}
          >
            <InterfaceIcon name={expanded ? "collapse" : "expand"} />
            {expanded ? "Contraer vista" : "Expandir vista"}
          </button>
        </header>
        {!selected && (notice || error) && <div>{feedback}</div>}
        {floatingCaptureOpen && quickCapture}
        <div className={expanded ? "min-h-0 flex-1 overflow-auto" : undefined}>
          {viewLoading}
          {boardOrCalendar}
        </div>
        {taskDetail}
        {renameDialog}
        {deleteConfirmation}
        {eventDialog}
      </main>
    );
  }

  return (
    <div className="min-h-svh">
      <AutomaticReleaseNotes />
      <div className="app-shell">
        <header
          className={`app-topbar ${desktopWindow ? "app-topbar-desktop" : ""}`}
        >
          <div className="flex min-w-0 items-center gap-2.5 md:flex-wrap md:gap-x-2 md:gap-y-0">
            {compactNavigation && (
              <button
                type="button"
                aria-label="Abrir menú de navegación"
                aria-haspopup="dialog"
                aria-controls="mobile-navigation"
                className="topbar-button size-11 shrink-0"
                onClick={() => navigation.current?.showModal()}
              >
                <InterfaceIcon name="menu" className="size-5" />
              </button>
            )}
            <div className="hidden min-w-0 items-center gap-2 text-xs text-muted md:flex md:flex-wrap">
              <span className="hidden md:inline">
                {space?.name ?? "Personal"}
              </span>
              <span aria-hidden="true" className="hidden md:inline">
                /
              </span>
              <span className="truncate text-sm font-semibold text-foreground md:text-xs md:break-all md:whitespace-normal">
                {heading ?? "Tareas"}
              </span>
            </div>
          </div>
          {compactNavigation && (
            <img
              src="/organify-favicon.png"
              alt="Organify"
              width={32}
              height={32}
              className="mobile-brand-icon pointer-events-none absolute left-1/2 size-8 -translate-x-1/2 object-contain md:hidden"
            />
          )}
          {desktopWindow && (
            <div
              aria-hidden="true"
              data-tauri-drag-region
              className="min-w-2 flex-1 self-stretch"
            />
          )}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={openPalette}
              className="topbar-button gap-2 px-2.5"
              aria-label="Comandos"
            >
              <InterfaceIcon name="terminal" />
              <span className="hidden sm:inline">Comandos</span>
              <kbd className="shortcut-key hidden lg:inline">Ctrl+K</kbd>
            </button>
            <AppControls
              preferences={preferences}
              viewPreferences={viewPreferences}
              store={personalRepositories.sync}
              onWorkspaceSession={setWorkspaceSession}
              darkMode={darkMode}
              onThemeChange={changeTheme}
            />
          </div>
          {desktopWindow && <DesktopWindowControls />}
        </header>
        <WorkspaceSidebar compact={compactNavigation} drawer={navigation}>
          <WorkspacePicker
            session={workspaceSession}
            spaces={sharedWorkspaces.spaces}
            space={space}
            error={sharedWorkspaces.error}
            status={space && sharedWorkspaces.statuses[space.membershipId]}
            disabled={capturing || creatingProject}
            onSelect={(id) => {
              changeWorkspace(id);
              navigation.current?.close();
            }}
            refresh={sharedWorkspaces.refresh}
          />
          <div className="grid gap-2">
            <nav
              aria-label="Vistas"
              className="grid min-w-0 content-start gap-1"
            >
              <details
                className="task-nav-group"
                open={tasksOpen}
                onToggle={(event) => setTasksOpen(event.currentTarget.open)}
              >
                <summary className="nav-link flex items-center gap-2.5">
                  <InterfaceIcon name="list" />
                  <span className="flex-1 font-semibold">Tareas</span>
                  <InterfaceIcon
                    name="chevron"
                    className="task-nav-chevron size-4"
                  />
                </summary>
                <div className="grid gap-1 pl-3">
                  {inboxes.map(({ id, label }) => (
                    <button
                      type="button"
                      key={id}
                      aria-current={
                        section === "tasks" && !projectId && activeInbox === id
                          ? "page"
                          : undefined
                      }
                      className="nav-link flex w-full min-w-0 items-center gap-2.5"
                      onClick={() => navigate(id)}
                    >
                      <InterfaceIcon
                        name={inboxIcons[id]}
                        className="size-4 shrink-0"
                      />
                      <span>{label}</span>
                      {id === "today" && snapshot && (
                        <span className="task-count ml-auto">
                          {todayItems.length - doneToday}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </details>
              {!space && (
                <button
                  type="button"
                  className="nav-link flex items-center gap-2.5"
                  aria-current={showRoutines ? "page" : undefined}
                  onClick={openRoutines}
                >
                  <InterfaceIcon name="sparkles" /> Rutinas
                </button>
              )}
              {!space && (
                <button
                  type="button"
                  className="nav-link flex items-center gap-2.5"
                  aria-current={showEvents ? "page" : undefined}
                  onClick={openEvents}
                >
                  <InterfaceIcon name="calendar" /> Eventos
                </button>
              )}
            </nav>
          </div>
          <div className="grid gap-2">
            <h2 className="sidebar-label">Proyectos</h2>
            <nav aria-label="Proyectos" className="grid min-w-0 gap-1">
              {projects.map((project) => (
                <ProjectNavigation
                  key={project.id}
                  project={project}
                  active={section === "tasks" && projectId === project.id}
                  open={() => navigate("all", project.id)}
                  save={(changes) =>
                    repositories.projects.update(project.id, changes)
                  }
                />
              ))}
            </nav>
            <form
              className="flex min-w-0 gap-1 md:max-w-56"
              onSubmit={createProject}
            >
              <input
                className="field min-w-0 flex-1"
                value={projectName}
                onChange={(event) => {
                  setProjectName(event.target.value);
                  setProjectCreationFailed(false);
                }}
                placeholder="Nuevo proyecto"
                aria-label="Nuevo proyecto"
                required
              />
              <Button
                type="submit"
                aria-label="Crear proyecto"
                disabled={!snapshot || creatingProject}
                className="max-md:size-11 max-md:shrink-0"
              >
                <InterfaceIcon name="plus" />
              </Button>
            </form>
            {compactNavigation && projectCreationFailed && error && (
              <p role="alert" className="px-2 text-sm text-danger">
                {error}
              </p>
            )}
          </div>
        </WorkspaceSidebar>

        <main className="app-content">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
            <h1 className="min-w-0 break-words text-[clamp(1.55rem,3vw,1.95rem)] font-semibold tracking-tight">
              {heading ?? "Tareas"}
            </h1>
            <time
              className="date-card"
              dateTime={localStamp(today).slice(0, 10)}
            >
              <span className="grid size-7 place-items-center rounded-md bg-tint text-accent-ink">
                <InterfaceIcon name="calendar" />
              </span>
              {formatToday(today)}
            </time>
          </div>
          {!space && snapshot && isToday && (
            <section className="focus-card" aria-labelledby="focus-title">
              <div className="relative z-10">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-accent-ink">
                  <InterfaceIcon name="sparkles" />
                  Enfoque diario
                </span>
                <h2
                  id="focus-title"
                  className="mt-2 text-2xl font-semibold tracking-tight"
                >
                  Tareas de hoy
                </h2>
                <div className="mt-4 flex flex-wrap items-center gap-2.5 text-xs text-muted">
                  <progress
                    className="focus-progress"
                    aria-label="Progreso de hoy"
                    value={doneToday}
                    max={todayItems.length || 1}
                  />
                  <span>
                    {doneToday} de {todayItems.length} completadas
                  </span>
                </div>
              </div>
              <div className="focus-art" aria-hidden="true">
                <span className="focus-orbit" />
                <span className="focus-orbit focus-orbit-outer" />
                <span className="focus-symbol">
                  <InterfaceIcon name="check" className="size-8" />
                </span>
                <InterfaceIcon
                  name="sparkles"
                  className="absolute top-8 left-7 size-4 text-primary"
                />
                <InterfaceIcon
                  name="sparkles"
                  className="absolute right-4 bottom-8 size-5 text-primary"
                />
              </div>
            </section>
          )}
          {showEvents &&
            (snapshot ? (
              <EventsAgenda
                events={snapshot.events}
                create={(date) => setEventAction({ date })}
                open={setEventAction}
                bindings={bindings}
              />
            ) : (
              <p className="text-sm text-muted" role="status">
                {readError
                  ? "No se pudieron cargar los eventos."
                  : "Cargando eventos."}
              </p>
            ))}
          {showRoutines &&
            (snapshot ? (
              <RoutinesWorkspace
                mode="routines"
                routines={snapshot.routines}
                now={now}
                store={repositories.routines}
                openRoutines={openRoutines}
                bindings={bindings}
              />
            ) : (
              <p className="text-sm text-muted" role="status">
                {readError
                  ? "No se pudieron cargar las rutinas."
                  : "Cargando rutinas…"}
              </p>
            ))}
          {snapshot && isToday && (
            <RoutinesWorkspace
              mode="today"
              routines={snapshot.routines}
              now={now}
              store={repositories.routines}
              openRoutines={openRoutines}
              bindings={bindings}
            />
          )}
          <section
            hidden={section !== "tasks"}
            className="task-panel"
            aria-labelledby="task-panel-title"
          >
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 id="task-panel-title" className="font-semibold">
                  {isToday ? "Tareas de hoy" : "Tareas"}
                </h2>
                {snapshot && (
                  <span
                    className="task-count"
                    aria-label={`${openCount} tareas sin completar`}
                  >
                    {openCount}
                  </span>
                )}
              </div>
              <details className="relative">
                <summary className="topbar-button disclosure-trigger gap-1.5 px-2.5">
                  <InterfaceIcon name="filter" />
                  Filtrar{statusFilter && ` · ${statusLabels[statusFilter]}`}
                </summary>
                <div className="action-popover p-2">
                  <select
                    className="field"
                    aria-label="Filtrar por estado"
                    value={statusFilter ?? ""}
                    onChange={(event) => {
                      const value = event.target.value;
                      setStatusFilter(
                        value === "todo" ||
                          value === "doing" ||
                          value === "done"
                          ? value
                          : undefined,
                      );
                      closeDisclosure(event.currentTarget);
                    }}
                  >
                    <option value="">Todos los estados</option>
                    <option value="todo">Pendiente</option>
                    <option value="doing">En curso</option>
                    <option value="done">Hecha</option>
                  </select>
                </div>
              </details>
            </div>
            {quickCapture}

            <div className="my-3 flex flex-wrap items-center justify-between gap-2">
              <div
                className="flex flex-wrap gap-1"
                role="group"
                aria-label="Presentación de tareas"
              >
                {layouts.map(({ id, label, icon }) => (
                  <button
                    key={id}
                    type="button"
                    className="nav-link flex items-center gap-1.5 px-2.5 text-xs"
                    aria-pressed={layout === id}
                    onClick={() => setLayout(id)}
                  >
                    <InterfaceIcon name={icon} />
                    {label}
                  </button>
                ))}
              </div>
              {!space && desktopWindow && layout !== "list" && (
                <FloatButton
                  label={`Abrir ${layout === "board" ? "Tablero" : "Calendario"} en una ventana independiente`}
                  onClick={() => void floatLayout()}
                  disabled={openingView}
                />
              )}
              <label className="search-field w-52">
                <InterfaceIcon name="search" className="size-4 shrink-0" />
                <input
                  className="min-w-0 flex-1 text-foreground outline-none placeholder:text-muted"
                  type="search"
                  placeholder="Buscar por título"
                  aria-label="Buscar por título"
                  value={taskSearch}
                  onChange={(event) => setTaskSearch(event.target.value)}
                />
              </label>
            </div>
            {!selected && feedback}
            {viewLoading}

            <div className="min-w-0">
              {boardOrCalendar}
              {snapshot &&
                layout === "list" &&
                (visible.length ? (
                  <ul {...swipeHandlers}>
                    {visible.map((item) => {
                      const project = item.projectId
                        ? projectById.get(item.projectId)
                        : undefined;
                      const done = item.status === "done";
                      const date =
                        activeInbox === "in-progress"
                          ? dateLabel(item, latestTaskStart(item, today))
                          : dateLabel(item);
                      return (
                        <li
                          key={item.id}
                          data-task-shortcut={item.id}
                          className={`task-row ${swipeEnabled ? "[touch-action:pan-y_pinch-zoom]" : ""}`}
                        >
                          <button
                            type="button"
                            aria-label={`Completar tarea: ${item.title}`}
                            aria-pressed={done}
                            className="task-check"
                            onClick={() =>
                              move(item.id, done ? "todo" : "done")
                            }
                          >
                            {done && (
                              <InterfaceIcon
                                name="check"
                                className="size-3.5"
                              />
                            )}
                          </button>
                          <button
                            type="button"
                            data-swipe-handle
                            className="min-w-0 flex-1 rounded-md py-1 text-left focus-visible:outline-2 focus-visible:outline-primary"
                            onClick={() => openTask(item.id)}
                          >
                            <span
                              className={`block text-sm font-semibold wrap-anywhere ${done ? "text-muted line-through" : ""}`}
                            >
                              {item.title}
                            </span>
                            {project && (
                              <span className="project-tag">
                                <span
                                  aria-hidden="true"
                                  className="project-dot"
                                  style={{ backgroundColor: project.color }}
                                />
                                {project.name}
                              </span>
                            )}
                          </button>
                          {date && (
                            <span className="text-xs text-muted">{date}</span>
                          )}
                          <div className="flex items-center gap-2">
                            <TaskStatusIcon item={item} now={now} />
                            <StatusSelect
                              value={item.status}
                              onChange={(status) => move(item.id, status)}
                            />
                          </div>
                          <details className="relative" name="task-actions">
                            <summary
                              className="nav-link disclosure-trigger grid size-9 place-items-center p-0"
                              aria-label={`Opciones de ${item.title}`}
                            >
                              <InterfaceIcon
                                name="more"
                                className="size-5 text-foreground [stroke-width:3]"
                              />
                            </summary>
                            <div className="action-popover p-1">
                              <button
                                type="button"
                                className="nav-link flex w-full items-center gap-2 whitespace-nowrap"
                                onClick={(event) => {
                                  closeDisclosure(event.currentTarget);
                                  openTask(item.id, true);
                                }}
                              >
                                <InterfaceIcon name="edit" />
                                Editar tarea
                              </button>
                              <button
                                type="button"
                                className="nav-link flex w-full items-center gap-2 whitespace-nowrap"
                                onClick={(event) => {
                                  closeDisclosure(event.currentTarget);
                                  setRenameId(item.id);
                                }}
                              >
                                <InterfaceIcon name="edit" />
                                Renombrar tarea
                              </button>
                              {!space && desktopWindow && (
                                <button
                                  type="button"
                                  className="nav-link flex w-full items-center gap-2 whitespace-nowrap"
                                  onClick={(event) => {
                                    closeDisclosure(event.currentTarget);
                                    void floatTask(item);
                                  }}
                                >
                                  <InterfaceIcon name="popout" />
                                  Abrir en ventana
                                </button>
                              )}
                              <button
                                type="button"
                                className="nav-link flex w-full items-center gap-2 whitespace-nowrap text-danger"
                                onClick={(event) => {
                                  closeDisclosure(event.currentTarget);
                                  setDeletion({ item });
                                }}
                              >
                                <InterfaceIcon name="trash" />
                                Eliminar tarea
                              </button>
                            </div>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="border-t border-line p-6 text-center text-sm text-muted">
                    No hay tareas en esta vista.
                  </p>
                ))}
            </div>
          </section>
        </main>
      </div>

      {taskDetail}
      {renameDialog}
      {deleteConfirmation}
      {eventDialog}

      {reminderAlert && (
        <div className="fixed right-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-xl border border-line bg-paper p-3 shadow-lg">
          <InterfaceIcon name="bell" className="size-4 shrink-0 text-primary" />
          <p role="status" className="text-sm wrap-anywhere">
            {reminderTitle
              ? `Recordatorio: ${reminderTitle}`
              : eventAlert
                ? "Tienes un recordatorio de Organify."
                : "Tienes una tarea pendiente."}
          </p>
          <CloseDialogButton onClick={() => setReminderAlert(undefined)} />
        </div>
      )}

      <dialog
        ref={palette}
        aria-labelledby="commands-title"
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border border-line bg-paper p-4 text-foreground shadow-xl backdrop:bg-black/35"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="commands-title" className="font-semibold">
            Comandos
          </h2>
          <CloseDialogButton onClick={() => palette.current?.close()} />
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const command = commands[0];
            if (command && !command.disabled) {
              palette.current?.close();
              command.run();
            }
          }}
        >
          <input
            autoFocus
            className="field mb-2 w-full"
            aria-label="Buscar comando"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar comando"
          />
        </form>
        {commands.length ? (
          <ul className="grid max-h-64 gap-1 overflow-auto">
            {commands.map(({ label, run, disabled }, index) => (
              <li key={`${index}-${label}`}>
                <button
                  type="button"
                  className="nav-link w-full disabled:opacity-50"
                  disabled={disabled}
                  onClick={() => {
                    palette.current?.close();
                    run();
                  }}
                >
                  {label}
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No hay comandos que coincidan.</p>
        )}
      </dialog>
    </div>
  );
}
