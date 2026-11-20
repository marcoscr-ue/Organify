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
  matchesInbox,
  type Id,
  type Inbox,
  type Item,
  type ItemChanges,
  type Project,
  type Status,
} from "@organify/core";
import { createTaskRepositories, type TaskSnapshot } from "@organify/storage";
import { Button } from "@/components/ui/button";
import sidebarLogo from "../../../organify_logo_sidebar_beta.png";
import { Board } from "./board";
import { CalendarView, type CalendarPosition } from "./calendar-view";
import {
  AppControls,
  CloseDialogButton,
  DeleteConfirmation,
  ReleaseNotes,
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
  reminderTime,
  scheduleReminder,
  watchReminders,
} from "./reminders";
import {
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
import { applyTheme, readDarkMode, themeStorageKey } from "./theme";

const repositories = createTaskRepositories();
const inboxes: { id: Inbox; label: string }[] = [
  { id: "today", label: "Hoy" },
  { id: "all", label: "Todas" },
  { id: "upcoming", label: "Próximas" },
  { id: "undated", label: "Sin fecha" },
];
const inboxIcons = {
  all: "inbox",
  today: "sun",
  upcoming: "calendar",
  undated: "clock",
} as const;
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

function dateLabel(item: Item): string | undefined {
  const date = item.start ?? item.due;
  if (!date) return;
  return new Intl.DateTimeFormat("es", {
    dateStyle: "medium",
    timeStyle: item.allDay ? undefined : "short",
  }).format(new Date(date));
}

function TaskDetail({
  item,
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
  const selectedDate = date ?? local.slice(0, 10);
  const selectedTime = time ?? (item.allDay ? "" : local.slice(11, 16));
  const selectedRecurrence = recurrence ?? item.recurrence ?? "";
  const [saving, setSaving] = useState(false);
  const [reminderDraft, setReminderDraft] = useState<string>();
  const [reminderError, setReminderError] = useState("");
  const project = projects.find(({ id }) => id === item.projectId);
  const reminder = reminderTime(item.id);
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
      if (
        !(await save({
          ...(title !== undefined && { title }),
          ...(projectId !== undefined && { projectId: projectId || undefined }),
          ...schedule,
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
          </form>
        )}
        <BlockNotes
          id={item.id}
          legacy={item.notes}
          documents={repositories.documents}
          editable={editing}
        />
        {editing ? (
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
                : "Mantén la aplicación abierta para recibir el aviso."}
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
        )}
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
  const [openingView, setOpeningView] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [darkMode, setDarkMode] = useState(readDarkMode);
  const [showRoutines, setShowRoutines] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(true);
  const [deletion, setDeletion] = useState<{ item: Item } | { ids: Id[] }>();
  const calendarPosition = useRef<CalendarPosition>(undefined);
  const [snapshot, setSnapshot] = useState<TaskSnapshot>();
  const [readError, setReadError] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const floatingTasks = floating?.kind !== "task" ? floating : undefined;
  const [inbox, setInbox] = useState<Inbox>(floatingTasks?.inbox ?? "today");
  const [projectId, setProjectId] = useState<Id | undefined>(
    floatingTasks?.projectId,
  );
  const [layout, setLayout] = useState<Layout>(floatingTasks?.kind ?? "list");
  const [selectedId, setSelectedId] = useState<Id | undefined>(
    floating?.kind === "task" ? floating.id : undefined,
  );
  const [startEditing, setStartEditing] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [input, setInput] = useState("");
  const [projectName, setProjectName] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [taskSearch, setTaskSearch] = useState(floatingTasks?.search ?? "");
  const [statusFilter, setStatusFilter] = useState<Status | undefined>(
    floatingTasks?.status,
  );
  const [query, setQuery] = useState("");
  const [reminderAlert, setReminderAlert] = useState<Id>();
  const capture = useRef<HTMLInputElement>(null);
  const palette = useRef<HTMLDialogElement>(null);

  useEffect(
    () => repositories.subscribe(setSnapshot, () => setReadError(true)),
    [],
  );

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
    if (!floating) return watchReminders(setReminderAlert);
  }, [floating]);
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
    setShowRoutines(false);
    if (!nextProject) setTasksOpen(true);
    if (layout === "calendar" && nextInbox !== "all") setLayout("list");
    setInbox(nextInbox);
    setTaskSearch("");
    setStatusFilter(undefined);
    setProjectId(nextProject);
    setSelectedId(undefined);
  }

  function openRoutines() {
    setShowRoutines(true);
    setSelectedId(undefined);
  }

  function openTask(id: Id, edit = false) {
    setNotice("");
    setError("");
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
      await cancelReminders(ids);
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
      () => openFloatingView({ kind: "task", id: item.id }, item.title),
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
      const id = await repositories.items.create({
        ...parseCapture(input),
        projectId,
      });
      setInbox("all");
      setStartEditing(true);
      setSelectedId(id);
    }, "Tarea creada.");
    if (created) setInput("");
    setCapturing(false);
  }

  async function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (creatingProject || !projectName.trim()) return;
    setCreatingProject(true);
    const created = await write(async () => {
      navigate("all", await repositories.projects.create(projectName));
    }, "Proyecto creado.");
    if (created) setProjectName("");
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
  const reminderTitle = snapshot?.items.find(
    (item) => item.id === reminderAlert,
  )?.title;
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
        matchesInbox(item, activeInbox, today),
    ) ?? [];
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const heading = showRoutines
    ? "Rutinas"
    : projectId
      ? projectById.get(projectId)?.name
      : inboxes.find(({ id }) => id === activeInbox)?.label;
  const isToday = !showRoutines && !projectId && activeInbox === "today";
  const openCount = visible.filter((item) => item.status !== "done").length;
  const allCommands: { label: string; run: () => void; disabled?: boolean }[] =
    [
      {
        label: "Capturar tarea",
        run: () => {
          setShowRoutines(false);
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
          setShowRoutines(false);
          setLayout(id);
        },
      })),
      ...inboxes.map(({ id, label }) => ({
        label: `Ir a ${label}`,
        run: () => navigate(id),
      })),
      { label: "Ir a Rutinas", run: openRoutines },
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
        desktopWindow && floating?.kind !== "task"
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
          projects={projectById}
          open={openTask}
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
        <div className={expanded ? "min-h-0 flex-1 overflow-auto" : undefined}>
          {viewLoading}
          {boardOrCalendar}
        </div>
        {taskDetail}
        {deleteConfirmation}
      </main>
    );
  }

  return (
    <div className="min-h-svh">
      <div className="app-shell">
        <header
          className={`app-topbar ${desktopWindow ? "app-topbar-desktop" : ""}`}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted">
            <span className="hidden sm:inline">Espacio de trabajo</span>
            <span aria-hidden="true" className="hidden sm:inline">
              /
            </span>
            <span className="break-all font-semibold text-foreground">
              {heading ?? "Tareas"}
            </span>
          </div>
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
              <InterfaceIcon name="search" />
              <span className="hidden sm:inline">Comandos</span>
              <kbd className="shortcut-key hidden lg:inline">Ctrl+K</kbd>
            </button>
            <AppControls
              store={repositories.sync}
              darkMode={darkMode}
              onThemeChange={changeTheme}
            />
          </div>
          {desktopWindow && <DesktopWindowControls />}
        </header>
        <aside className="app-sidebar">
          <img
            src={sidebarLogo}
            alt="Organify"
            width={2172}
            height={724}
            className="sidebar-logo h-auto w-36 object-contain md:mb-3 md:w-full md:max-w-53"
          />
          <div className="grid gap-2">
            <h2 id="task-navigation-title" className="sidebar-label">
              Espacio de trabajo
            </h2>
            <nav
              aria-labelledby="task-navigation-title"
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
                <div className="grid grid-cols-2 gap-1 pl-3 md:grid-cols-1">
                  {inboxes.map(({ id, label }) => (
                    <button
                      type="button"
                      key={id}
                      aria-current={
                        !showRoutines && !projectId && activeInbox === id
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
              <button
                type="button"
                className="nav-link flex items-center gap-2.5"
                aria-current={showRoutines ? "page" : undefined}
                onClick={openRoutines}
              >
                <InterfaceIcon name="sparkles" /> Rutinas
              </button>
            </nav>
          </div>
          <div className="grid gap-2">
            <h2 className="sidebar-label">Proyectos</h2>
            <nav
              aria-label="Proyectos"
              className="flex min-w-0 flex-wrap gap-1 md:grid"
            >
              {projects.map((project) => (
                <ProjectNavigation
                  key={project.id}
                  project={project}
                  active={!showRoutines && projectId === project.id}
                  open={() => navigate("all", project.id)}
                  save={(changes) =>
                    repositories.projects.update(project.id, changes)
                  }
                />
              ))}
            </nav>
            <form
              className="flex min-w-0 max-w-56 gap-1"
              onSubmit={createProject}
            >
              <input
                className="field min-w-0 flex-1"
                value={projectName}
                onChange={(event) => setProjectName(event.target.value)}
                placeholder="Nuevo proyecto"
                aria-label="Nuevo proyecto"
                required
              />
              <Button
                type="submit"
                aria-label="Crear proyecto"
                disabled={!snapshot || creatingProject}
              >
                <InterfaceIcon name="plus" />
              </Button>
            </form>
          </div>
          <div className="mt-auto">
            <ReleaseNotes />
          </div>
        </aside>

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
          {snapshot && isToday && (
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
          {showRoutines &&
            (snapshot ? (
              <RoutinesWorkspace
                mode="routines"
                routines={snapshot.routines}
                now={now}
                store={repositories.routines}
                openRoutines={openRoutines}
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
            />
          )}
          <section
            hidden={showRoutines}
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
              {desktopWindow && layout !== "list" && (
                <FloatButton
                  label={`Abrir ${layout === "board" ? "Tablero" : "Calendario"} en una ventana independiente`}
                  onClick={() => void floatLayout()}
                  disabled={openingView}
                />
              )}
              <label className="search-field">
                <InterfaceIcon name="search" />
                <input
                  className="w-28 min-w-0 text-foreground outline-none placeholder:text-muted"
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
                  <ul>
                    {visible.map((item) => {
                      const project = item.projectId
                        ? projectById.get(item.projectId)
                        : undefined;
                      const done = item.status === "done";
                      const date = dateLabel(item);
                      return (
                        <li key={item.id} className="task-row">
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
                              {desktopWindow && (
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
      {deleteConfirmation}

      {reminderAlert && (
        <div className="fixed right-4 bottom-4 z-30 flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-xl border border-line bg-paper p-3 shadow-lg">
          <InterfaceIcon name="bell" className="size-4 shrink-0 text-primary" />
          <p role="status" className="text-sm wrap-anywhere">
            {reminderTitle
              ? `Recordatorio: ${reminderTitle}`
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
