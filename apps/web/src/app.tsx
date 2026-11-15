import { useEffect, useRef, useState, type FormEvent } from "react";
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
import { Board } from "./board";
import { SyncSettings } from "./sync-settings";
import { CalendarView } from "./calendar-view";
import {
  localStamp,
  repeatOptions,
  scheduleChanges,
} from "./calendar-schedule";
import { parseCapture } from "./quick-capture";
import { ProjectSelect, StatusSelect } from "./task-controls";

const repositories = createTaskRepositories();
const inboxes: { id: Inbox; label: string }[] = [
  { id: "all", label: "Todas" },
  { id: "today", label: "Hoy" },
  { id: "upcoming", label: "Próximas" },
  { id: "undated", label: "Sin fecha" },
];

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
  save,
  remove,
  close,
}: {
  item: Item;
  projects: Project[];
  save: (changes: ItemChanges) => Promise<boolean>;
  remove: () => void;
  close: () => void;
}) {
  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes);
  const [projectId, setProjectId] = useState(item.projectId ?? "");
  const scheduled = item.start ?? item.due;
  const local = scheduled ? localStamp(new Date(scheduled)) : "";
  const [date, setDate] = useState<string | undefined>();
  const [time, setTime] = useState<string | undefined>();
  const [recurrence, setRecurrence] = useState<string | undefined>();
  const selectedDate = date ?? local.slice(0, 10);
  const selectedTime = time ?? (item.allDay ? "" : local.slice(11, 16));
  const selectedRecurrence = recurrence ?? item.recurrence ?? "";
  const [saving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      const scheduleEdited =
        date !== undefined || time !== undefined || recurrence !== undefined;
      const start = selectedDate
        ? new Date(selectedDate + "T" + (selectedTime || "00:00"))
        : undefined;
      const schedule = scheduleEdited
        ? scheduleChanges(item, start, !selectedTime, selectedRecurrence)
        : {};
      if (
        await save({
          title,
          notes,
          projectId: projectId || undefined,
          ...schedule,
        })
      ) {
        setDate(undefined);
        setTime(undefined);
        setRecurrence(undefined);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <aside
      className="rounded-xl border border-line bg-paper p-4 lg:w-80"
      aria-label="Detalle de tarea"
    >
      <div className="mb-4 flex items-center justify-between gap-2">
        <h2 className="font-semibold">Detalle de tarea</h2>
        <button
          type="button"
          onClick={close}
          className="rounded px-2 text-sm text-muted hover:bg-panel"
        >
          Cerrar
        </button>
      </div>
      <form className="grid gap-3" onSubmit={submit}>
        <label className="grid gap-1 text-sm">
          Título
          <input
            className="field"
            value={title}
            required
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Proyecto
          <ProjectSelect
            value={projectId}
            onChange={setProjectId}
            projects={projects}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Notas
          <textarea
            className="field min-h-28"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Fecha
          <input
            type="date"
            className="field min-w-0"
            value={selectedDate}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Hora (opcional)
          <input
            type="time"
            className="field min-w-0"
            value={selectedDate ? selectedTime : ""}
            disabled={!selectedDate}
            onChange={(event) => setTime(event.target.value)}
          />
        </label>
        <label className="grid gap-1 text-sm">
          Repetición
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
        </label>
        {selectedDate && selectedRecurrence && (
          <p className="text-sm text-muted">
            Los cambios se aplican a toda la serie.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={saving}>
            Guardar
          </Button>
          <button
            type="button"
            disabled={saving}
            onClick={remove}
            className="rounded px-2 py-1 text-sm text-danger hover:underline"
          >
            Eliminar
          </button>
        </div>
      </form>
    </aside>
  );
}

export function App() {
  const [snapshot, setSnapshot] = useState<TaskSnapshot>();
  const [readError, setReadError] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [inbox, setInbox] = useState<Inbox>("all");
  const [projectId, setProjectId] = useState<Id>();
  const [view, setView] = useState<"list" | "board" | "calendar">("list");
  const [selectedId, setSelectedId] = useState<Id>();
  const [input, setInput] = useState("");
  const [projectName, setProjectName] = useState("");
  const [capturing, setCapturing] = useState(false);
  const [creatingProject, setCreatingProject] = useState(false);
  const [query, setQuery] = useState("");
  const capture = useRef<HTMLInputElement>(null);
  const palette = useRef<HTMLDialogElement>(null);

  useEffect(
    () => repositories.subscribe(setSnapshot, () => setReadError(true)),
    [],
  );

  function openPalette() {
    if (!palette.current?.open) {
      setQuery("");
      palette.current?.showModal();
    }
  }

  useEffect(() => {
    function shortcut(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openPalette();
      }
    }
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);

  function navigate(nextInbox: Inbox, nextProject?: Id) {
    if (view === "calendar" && nextInbox !== "all") setView("list");
    setInbox(nextInbox);
    setProjectId(nextProject);
    setSelectedId(undefined);
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
  const now = new Date();
  const visible =
    snapshot?.items.filter(
      (item) =>
        (!projectId || item.projectId === projectId) &&
        matchesInbox(item, inbox, now),
    ) ?? [];
  const projectById = new Map(
    projects.map((project) => [project.id, project.name]),
  );
  const heading = projectId
    ? projectById.get(projectId)
    : inboxes.find(({ id }) => id === (view === "calendar" ? "all" : inbox))
        ?.label;
  const commands = [
    { label: "Capturar tarea", run: () => capture.current?.focus() },
    { label: "Abrir lista", run: () => setView("list") },
    { label: "Abrir tablero", run: () => setView("board") },
    { label: "Abrir calendario", run: () => setView("calendar") },
    ...inboxes.map(({ id, label }) => ({
      label: `Ir a ${label}`,
      run: () => navigate(id),
    })),
    ...projects.map(({ id, name }) => ({
      label: `Abrir proyecto ${name}`,
      run: () => navigate("all", id),
    })),
  ].filter(({ label }) =>
    label
      .toLocaleLowerCase("es")
      .includes(query.trim().toLocaleLowerCase("es")),
  );

  return (
    <div className="min-h-svh">
      <div className="grid min-h-svh w-full md:grid-cols-[14rem_minmax(0,1fr)]">
        <aside className="grid min-w-0 content-start gap-5 border-b border-line bg-paper p-4 md:border-r md:border-b-0 md:p-4">
          <p className="text-lg font-semibold tracking-tight">Organify</p>
          <nav
            aria-label="Vistas"
            className="flex min-w-0 flex-wrap gap-1 md:grid"
          >
            {inboxes.map(({ id, label }) => (
              <button
                type="button"
                key={id}
                aria-current={
                  !projectId && (view === "calendar" ? "all" : inbox) === id
                    ? "page"
                    : undefined
                }
                className="nav-link w-full min-w-0"
                onClick={() => navigate(id)}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="grid gap-2">
            <h2 className="text-sm font-semibold">Proyectos</h2>
            <nav
              aria-label="Proyectos"
              className="flex min-w-0 flex-wrap gap-1 md:grid"
            >
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  aria-current={projectId === project.id ? "page" : undefined}
                  className="nav-link w-full min-w-0"
                  onClick={() => navigate("all", project.id)}
                >
                  {project.name}
                </button>
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
                +
              </Button>
            </form>
          </div>
          <SyncSettings store={repositories.sync} />
        </aside>

        <main className="min-w-0 p-4 sm:p-6 lg:p-8">
          <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h1 className="text-3xl font-semibold tracking-tight">
              {heading ?? "Tareas"}
            </h1>
            <button
              type="button"
              onClick={openPalette}
              className="rounded-lg border border-line bg-paper px-3 py-2 text-sm"
            >
              Comandos <kbd className="ml-2 text-muted">Ctrl+K</kbd>
            </button>
          </header>

          <form className="mb-4 flex gap-2" onSubmit={captureTask}>
            <input
              ref={capture}
              className="field min-w-0 flex-1 bg-paper"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Reunión con Ana mañana a las 10:00"
              aria-label="Captura rápida"
              required
            />
            <Button type="submit" disabled={!snapshot || capturing}>
              Añadir
            </Button>
          </form>

          <div
            className="mb-4 flex flex-wrap gap-2"
            role="group"
            aria-label="Presentación de tareas"
          >
            <button
              type="button"
              className="nav-link w-full min-w-0"
              aria-pressed={view === "list"}
              onClick={() => setView("list")}
            >
              Lista
            </button>
            <button
              type="button"
              className="nav-link w-full min-w-0"
              aria-pressed={view === "board"}
              onClick={() => setView("board")}
            >
              Tablero
            </button>
            <button
              type="button"
              className="nav-link"
              aria-pressed={view === "calendar"}
              onClick={() => setView("calendar")}
            >
              Calendario
            </button>
          </div>

          <p role="status" className="text-sm text-muted empty:hidden">
            {notice}
          </p>
          {error && (
            <p role="alert" className="mb-3 text-sm text-danger">
              {error}
            </p>
          )}
          {readError && (
            <p role="alert" className="text-sm text-danger">
              No se pudieron leer las tareas guardadas en este navegador.
            </p>
          )}
          {!snapshot && !readError && (
            <p className="text-sm text-muted">Cargando tareas…</p>
          )}

          <div className="grid items-start gap-4 xl:flex">
            <div className="min-w-0 flex-1">
              {snapshot && view === "calendar" && (
                <CalendarView
                  items={snapshot.items.filter(
                    (item) => !projectId || item.projectId === projectId,
                  )}
                  open={setSelectedId}
                  reschedule={(id, changes) =>
                    write(
                      () => repositories.items.update(id, changes),
                      "Tarea reprogramada.",
                    )
                  }
                />
              )}
              {snapshot && view === "board" && (
                <Board items={visible} open={setSelectedId} move={move} />
              )}
              {snapshot &&
                view === "list" &&
                (visible.length ? (
                  <ul className="divide-y divide-line rounded-xl border border-line bg-paper">
                    {visible.map((item) => (
                      <li
                        key={item.id}
                        className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <button
                            type="button"
                            className="break-words text-left font-medium hover:underline"
                            onClick={() => setSelectedId(item.id)}
                          >
                            {item.title}
                          </button>
                          <p className="text-sm text-muted empty:hidden">
                            {[
                              dateLabel(item),
                              item.projectId && projectById.get(item.projectId),
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        </div>
                        <StatusSelect
                          value={item.status}
                          onChange={(status) => move(item.id, status)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-line bg-paper p-4 text-sm text-muted">
                    No hay tareas en esta vista.
                  </p>
                ))}
            </div>

            {selected && (
              <TaskDetail
                key={selected.id}
                item={selected}
                projects={projects}
                save={(changes) =>
                  write(
                    () => repositories.items.update(selected.id, changes),
                    "Tarea guardada.",
                  )
                }
                remove={() => {
                  if (!window.confirm(`¿Eliminar «${selected.title}»?`)) return;
                  void write(
                    () => repositories.items.remove(selected.id),
                    "Tarea eliminada.",
                  ).then((removed) => {
                    if (removed)
                      setSelectedId((id) =>
                        id === selected.id ? undefined : id,
                      );
                  });
                }}
                close={() => setSelectedId(undefined)}
              />
            )}
          </div>
        </main>
      </div>

      <dialog
        ref={palette}
        aria-labelledby="commands-title"
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border border-line bg-paper p-4 text-foreground shadow-xl backdrop:bg-black/35"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 id="commands-title" className="font-semibold">
            Comandos
          </h2>
          <button
            type="button"
            className="rounded px-2 text-sm text-muted hover:bg-panel"
            onClick={() => palette.current?.close()}
          >
            Cerrar
          </button>
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const command = commands[0];
            if (command) {
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
            {commands.map(({ label, run }, index) => (
              <li key={`${index}-${label}`}>
                <button
                  type="button"
                  className="nav-link w-full"
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
