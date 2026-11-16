import { statuses, type Item, type Project, type Status } from "@organify/core";
import { isOverdue } from "./task-deadline";

export const statusLabels: Record<Status, string> = {
  todo: "Pendiente",
  doing: "En curso",
  done: "Hecha",
};

export function TaskStatusIcon({ item, now }: { item: Item; now: number }) {
  const done = item.status === "done";
  if (!done && !isOverdue(item, now)) return null;

  const label = done ? "Tarea completada" : "Tarea vencida";
  return (
    <svg
      role="img"
      aria-label={label}
      className={`size-5 shrink-0 ${done ? "text-green-700" : "text-danger"}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{label}</title>
      {done ? (
        <path d="m5 12 4 4L19 6" />
      ) : (
        <>
          <circle cx="12" cy="13" r="7" />
          <path d="M12 9v4l2 2M5 3 2 6m17-3 3 3M7 19l-2 2m12-2 2 2" />
        </>
      )}
    </svg>
  );
}

export function StatusSelect({
  value,
  onChange,
}: {
  value: Status;
  onChange: (status: Status) => void;
}) {
  return (
    <select
      className="field"
      aria-label="Estado"
      value={value}
      onChange={(event) => {
        const status = statuses.find((value) => value === event.target.value);
        if (status) onChange(status);
      }}
    >
      {statuses.map((status) => (
        <option key={status} value={status}>
          {statusLabels[status]}
        </option>
      ))}
    </select>
  );
}

export function ProjectSelect({
  value,
  onChange,
  projects,
}: {
  value: string;
  onChange: (id: string) => void;
  projects: Project[];
}) {
  return (
    <select
      className="field"
      aria-label="Proyecto"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">Sin proyecto</option>
      {projects.map((project) => (
        <option key={project.id} value={project.id}>
          {project.name}
        </option>
      ))}
    </select>
  );
}
