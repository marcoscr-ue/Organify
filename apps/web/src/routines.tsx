import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  routineProgress,
  shiftRoutineDate,
  type Routine,
  type RoutineCycle,
  type RoutineFrequency,
  type RoutineInput,
} from "@organify/core";
import type { TaskRepositories } from "@organify/storage";
import { Button } from "@/components/ui/button";
import { CloseDialogButton, DeleteConfirmation } from "./app-overlays";
import { InterfaceIcon } from "./interface-icon";

type Progress = ReturnType<typeof routineProgress>;
type RoutineEntry = Progress & { routine: Routine };

const frequencyLabel = { daily: "Diaria", weekly: "Semanal" };
const dateFormat = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});
const historyFormat = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function dateLabel(value: string) {
  return dateFormat.format(new Date(value));
}

function periodLabel(cycle: RoutineCycle, history = false) {
  const format = history ? historyFormat : dateFormat;
  const start = new Date(cycle.start);
  const last = new Date(shiftRoutineDate(cycle.end, -1));
  return +start === +last
    ? format.format(start)
    : format.formatRange(start, last);
}

function checkedCount(cycle: RoutineCycle) {
  return cycle.steps.filter(({ id }) => cycle.checked.has(id)).length;
}

function streakLabel(streak: number, frequency: RoutineFrequency) {
  if (frequency === "weekly")
    return streak === 1 ? "1 semana seguida" : `${streak} semanas seguidas`;
  return streak === 1 ? "1 día seguido" : `${streak} días seguidos`;
}

function RoutineProgressBar({ cycle }: { cycle: RoutineCycle }) {
  const count = checkedCount(cycle);
  return (
    <span className="routine-progress">
      <progress
        aria-label="Pasos completados"
        value={count}
        max={cycle.steps.length}
      />
      <span>
        {count} de {cycle.steps.length} pasos
      </span>
    </span>
  );
}

function Checklist({
  cycle,
  busy,
  onCheck,
}: {
  cycle: RoutineCycle;
  busy: boolean;
  onCheck: (id: string, checked: boolean) => void;
}) {
  return (
    <div className="routine-checklist">
      {cycle.steps.map(({ id, label }) => (
        <label className="routine-step" key={id}>
          <input
            type="checkbox"
            checked={cycle.checked.has(id)}
            disabled={busy}
            onChange={(event) => onCheck(id, event.currentTarget.checked)}
          />
          <span>{label}</span>
        </label>
      ))}
    </div>
  );
}

function RoutineDialog({
  title,
  caption,
  children,
  busy,
  close,
}: {
  title: string;
  caption: string;
  children: ReactNode;
  busy: boolean;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
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
          <div className="min-w-0">
            <p className="routine-caption">
              <InterfaceIcon name="calendar" /> {caption}
            </p>
            <h2
              id={titleId}
              className="mt-2 text-2xl font-semibold wrap-anywhere"
            >
              {title}
            </h2>
          </div>
          <CloseDialogButton onClick={close} disabled={busy} />
        </div>
        {children}
      </div>
    </dialog>
  );
}

function emptyStep() {
  return { id: crypto.randomUUID(), label: "" };
}

function RoutineEditor({
  entry,
  busy,
  error,
  save,
  close,
}: {
  entry?: RoutineEntry;
  busy: boolean;
  error: string;
  save: (input: RoutineInput, original: RoutineInput) => void;
  close: () => void;
}) {
  const [original] = useState<RoutineInput>(() =>
    entry
      ? { name: entry.routine.name, ...entry.nextSchedule }
      : { name: "", frequency: "daily", steps: [emptyStep()] },
  );
  const [draft, setDraft] = useState(original);
  function moveStep(index: number, direction: -1 | 1) {
    const steps = [...draft.steps];
    const [step] = steps.splice(index, 1);
    steps.splice(index + direction, 0, step);
    setDraft({ ...draft, steps });
  }

  return (
    <RoutineDialog
      title={entry ? "Editar rutina" : "Nueva rutina"}
      caption="Checklist"
      busy={busy}
      close={close}
    >
      <form
        className="mt-5 space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) save(draft, original);
        }}
      >
        <label className="routine-field">
          Nombre de la rutina
          <input
            autoFocus
            className="field"
            required
            value={draft.name}
            placeholder="Ej. Revisión semanal"
            onChange={(event) =>
              setDraft({ ...draft, name: event.target.value })
            }
          />
        </label>
        <label className="routine-field">
          Frecuencia
          <select
            className="field"
            value={draft.frequency}
            onChange={(event) =>
              setDraft({
                ...draft,
                frequency: event.target.value === "weekly" ? "weekly" : "daily",
              })
            }
          >
            <option value="daily">Diaria</option>
            <option value="weekly">Semanal</option>
          </select>
        </label>
        <fieldset className="grid gap-2">
          <legend className="mb-2 text-sm font-semibold">Pasos</legend>
          {draft.steps.map((step, index) => (
            <div key={step.id} className="flex items-center gap-1">
              <input
                className="field min-w-0 flex-1"
                required
                aria-label={`Paso ${index + 1}`}
                placeholder={`Paso ${index + 1}`}
                value={step.label}
                onChange={(event) => {
                  const label = event.currentTarget.value;
                  setDraft({
                    ...draft,
                    steps: draft.steps.map((item) =>
                      item.id === step.id ? { ...item, label } : item,
                    ),
                  });
                }}
              />
              <button
                type="button"
                className="routine-icon-button"
                disabled={index === 0}
                aria-label={`Subir paso ${index + 1}`}
                onClick={() => moveStep(index, -1)}
              >
                <InterfaceIcon name="up" />
              </button>
              <button
                type="button"
                className="routine-icon-button"
                disabled={index === draft.steps.length - 1}
                aria-label={`Bajar paso ${index + 1}`}
                onClick={() => moveStep(index, 1)}
              >
                <InterfaceIcon name="down" />
              </button>
              <button
                type="button"
                className="routine-icon-button"
                disabled={draft.steps.length === 1}
                aria-label={`Quitar paso ${index + 1}`}
                onClick={() =>
                  setDraft({
                    ...draft,
                    steps: draft.steps.filter(({ id }) => id !== step.id),
                  })
                }
              >
                <InterfaceIcon name="trash" />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="nav-link flex w-fit items-center gap-1.5 text-accent-ink"
            onClick={() =>
              setDraft({ ...draft, steps: [...draft.steps, emptyStep()] })
            }
          >
            <InterfaceIcon name="plus" /> Añadir paso
          </button>
        </fieldset>
        {entry && (
          <p className="text-sm text-muted">
            Los cambios de frecuencia y pasos se aplican el{" "}
            {dateLabel(entry.cycle.end)}.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            className="border border-control-line bg-paper text-foreground hover:bg-panel"
            type="button"
            disabled={busy}
            onClick={close}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {entry ? "Guardar cambios" : "Crear rutina"}
          </Button>
        </div>
      </form>
    </RoutineDialog>
  );
}

function RoutineDetail({
  entry,
  busy,
  error,
  check,
  pause,
  edit,
  remove,
  close,
}: {
  entry: RoutineEntry;
  busy: boolean;
  error: string;
  check: (id: string, checked: boolean) => void;
  pause: () => void;
  edit: () => void;
  remove: () => void;
  close: () => void;
}) {
  const { routine, cycle, streak, history, nextPaused, started } = entry;
  const [historyLimit, setHistoryLimit] = useState(5);
  const pausePending = nextPaused !== cycle.paused;
  return (
    <RoutineDialog
      title={routine.name}
      caption={`Periodo actual · ${frequencyLabel[cycle.frequency]}`}
      busy={busy}
      close={close}
    >
      <p className="mt-1 text-sm text-muted">{periodLabel(cycle)}</p>
      {cycle.paused || !started ? (
        <p className="my-5 rounded-lg bg-panel p-3 text-sm text-muted">
          {cycle.paused
            ? "Rutina en pausa"
            : `Empieza el ${dateLabel(cycle.start)}`}
        </p>
      ) : (
        <div className="my-5 space-y-2">
          <RoutineProgressBar cycle={cycle} />
          <Checklist cycle={cycle} busy={busy} onCheck={check} />
        </div>
      )}
      <div className="routine-streak-panel">
        <span className="routine-streak">
          <InterfaceIcon name="flame" /> {streakLabel(streak, cycle.frequency)}
        </span>
        <span className="text-xs text-muted">Racha actual</span>
      </div>
      <h3 className="mt-5 mb-2 text-sm font-semibold">Historial</h3>
      {history.length ? (
        <>
          <ul>
            {history.slice(0, historyLimit).map((past) => (
              <li className="routine-history-row" key={past.start}>
                <span>{periodLabel(past, true)}</span>
                <strong
                  className={past.complete ? "text-success" : "text-muted"}
                >
                  {past.paused
                    ? "En pausa"
                    : past.complete
                      ? "Completado"
                      : "Incompleto"}
                </strong>
              </li>
            ))}
          </ul>
          {history.length > historyLimit && (
            <button
              type="button"
              className="nav-link mt-1"
              onClick={() => setHistoryLimit(historyLimit + 10)}
            >
              Ver más ciclos
            </button>
          )}
        </>
      ) : (
        <p className="text-sm text-muted">
          El historial aparecerá al cerrar el primer ciclo.
        </p>
      )}
      {pausePending && (
        <p className="mt-4 text-sm text-muted">
          {nextPaused ? "En pausa" : "Se reanuda"} desde el{" "}
          {dateLabel(cycle.end)}.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button
          className="border border-control-line bg-paper text-foreground hover:bg-panel"
          disabled={busy}
          onClick={edit}
        >
          Editar
        </Button>
        <Button
          className="border border-control-line bg-paper text-foreground hover:bg-panel"
          disabled={busy}
          onClick={pause}
        >
          {pausePending
            ? nextPaused
              ? "Cancelar pausa"
              : "Cancelar reanudación"
            : nextPaused
              ? "Reanudar"
              : "Pausar"}
        </Button>
        <button
          type="button"
          className="routine-icon-button ml-auto text-danger"
          disabled={busy}
          aria-label="Eliminar rutina"
          onClick={remove}
        >
          <InterfaceIcon name="trash" />
        </button>
      </div>
    </RoutineDialog>
  );
}

export function RoutinesWorkspace({
  mode,
  routines,
  now,
  store,
  openRoutines,
}: {
  mode: "today" | "routines";
  routines: Routine[];
  now: number;
  store: TaskRepositories["routines"];
  openRoutines: () => void;
}) {
  const [selectedId, setSelectedId] = useState<string>();
  const [editor, setEditor] = useState<"create" | "edit">();
  const [deleting, setDeleting] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const entries = routines.map((routine) => ({
    routine,
    ...routineProgress(routine, now),
  }));
  const active = entries.filter(
    ({ cycle, started }) => started && !cycle.paused,
  );
  const ordered = [...entries].sort(
    (a, b) => Number(a.cycle.paused) - Number(b.cycle.paused),
  );
  const today = [...active].sort(
    (a, b) => Number(a.cycle.complete) - Number(b.cycle.complete),
  );
  const selected = entries.find(({ routine }) => routine.id === selectedId);

  async function write(operation: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await operation();
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo guardar la rutina.",
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  function check(
    { routine, cycle }: RoutineEntry,
    id: string,
    checked: boolean,
  ) {
    void write(() => store.setStep(routine.id, cycle.start, id, checked));
  }

  function closeDetail() {
    setError("");
    setSelectedId(undefined);
  }

  function closeEditor() {
    setError("");
    setEditor(undefined);
  }

  if (mode === "today") {
    if (!active.length) return null;
    return (
      <section className="today-routines" aria-labelledby="today-routine-title">
        <div className="routine-summary">
          <span className="routine-symbol">
            <InterfaceIcon name="sparkles" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="today-routine-title" className="text-sm font-semibold">
              Rutinas de hoy
            </h2>
            <p className="text-xs text-muted">
              {active.filter(({ cycle }) => cycle.complete).length} de{" "}
              {active.length} completadas
            </p>
          </div>
          <button
            type="button"
            className="nav-link shrink-0"
            onClick={openRoutines}
          >
            Ver rutinas
          </button>
        </div>
        <ul>
          {today.map((entry) => {
            const { routine, cycle } = entry;
            const open = expanded === routine.id;
            return (
              <li key={routine.id} className="border-t border-line">
                <button
                  type="button"
                  className="today-routine-toggle"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? undefined : routine.id)}
                >
                  <span className="min-w-0 flex-1 font-medium wrap-anywhere">
                    {routine.name}
                  </span>
                  <span
                    className={cycle.complete ? "text-success" : "text-muted"}
                  >
                    {checkedCount(cycle)} de {cycle.steps.length}
                  </span>
                  <InterfaceIcon
                    name="chevron"
                    className={open ? "size-4" : "size-4 -rotate-90"}
                  />
                </button>
                {open && (
                  <div className="px-3 pb-3">
                    <Checklist
                      cycle={cycle}
                      busy={busy}
                      onCheck={(id, checked) => check(entry, id, checked)}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {error && (
          <p role="alert" className="px-4 pb-3 text-sm text-danger">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-label="Mis rutinas">
      <div className="routine-summary routine-overview">
        <span className="routine-symbol">
          <InterfaceIcon name="calendar" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {active.length}{" "}
            {active.length === 1 ? "rutina activa" : "rutinas activas"}
          </p>
          <p className="text-xs text-muted">
            {active.filter(({ cycle }) => cycle.complete).length} completadas en
            el ciclo actual
          </p>
        </div>
        <Button
          onClick={() => {
            setError("");
            setEditor("create");
          }}
        >
          <InterfaceIcon name="plus" /> Nueva rutina
        </Button>
      </div>
      {ordered.length ? (
        <div className="routine-grid">
          {ordered.map(({ routine, cycle, streak, nextPaused }) => (
            <button
              key={routine.id}
              type="button"
              className="routine-card"
              onClick={() => {
                setError("");
                setSelectedId(routine.id);
              }}
            >
              <span className="flex items-center justify-between gap-2">
                <span
                  className={`routine-symbol ${cycle.frequency === "weekly" ? "routine-symbol-weekly" : ""}`}
                >
                  <InterfaceIcon name="calendar" />
                </span>
                <span className="text-xs text-muted">
                  {cycle.paused
                    ? "En pausa"
                    : nextPaused
                      ? "Pausa programada"
                      : cycle.complete
                        ? "Completada"
                        : ""}
                </span>
              </span>
              <span className="mt-3 block text-xs text-muted">
                {frequencyLabel[cycle.frequency]} ·{" "}
                {cycle.frequency === "weekly" ? "Cada lunes" : "Cada día"}
              </span>
              <span className="mt-1 block text-base font-semibold wrap-anywhere">
                {routine.name}
              </span>
              <span className="my-3 block">
                <RoutineProgressBar cycle={cycle} />
              </span>
              <span className="routine-card-footer routine-streak">
                <InterfaceIcon name="flame" />{" "}
                {streakLabel(streak, cycle.frequency)}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="routine-empty">
          Crea una rutina diaria o semanal para empezar.
        </p>
      )}

      {selected && (
        <RoutineDetail
          key={selected.routine.id}
          entry={selected}
          busy={busy}
          error={error}
          check={(id, checked) => check(selected, id, checked)}
          pause={() => {
            void write(() =>
              store.setPaused(selected.routine.id, !selected.nextPaused),
            );
          }}
          edit={() => {
            setError("");
            setEditor("edit");
          }}
          remove={() => setDeleting(true)}
          close={closeDetail}
        />
      )}
      {(editor === "create" || (editor === "edit" && selected)) && (
        <RoutineEditor
          entry={editor === "edit" ? selected : undefined}
          busy={busy}
          error={error}
          close={closeEditor}
          save={async (input, original) => {
            const { name, ...schedule } = input;
            const changedSchedule =
              schedule.frequency !== original.frequency ||
              JSON.stringify(schedule.steps) !== JSON.stringify(original.steps);
            if (
              await write(() =>
                editor === "edit" && selected
                  ? store.update(selected.routine.id, {
                      name: name === original.name ? undefined : name,
                      schedule: changedSchedule ? schedule : undefined,
                    })
                  : store.create(input),
              )
            )
              closeEditor();
          }}
        />
      )}
      {deleting && selected && (
        <DeleteConfirmation
          title="Eliminar rutina"
          confirmLabel="Eliminar rutina"
          onCancel={() => setDeleting(false)}
          onConfirm={async () => {
            await store.remove(selected.routine.id);
            setDeleting(false);
            closeDetail();
          }}
        >
          Se eliminará «{selected.routine.name}» y su historial.
        </DeleteConfirmation>
      )}
    </section>
  );
}
