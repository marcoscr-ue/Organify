import { statuses, type Project, type Status } from "@organify/core";

export const statusLabels: Record<Status, string> = {
  todo: "Pendiente",
  doing: "En curso",
  done: "Hecha",
};

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
