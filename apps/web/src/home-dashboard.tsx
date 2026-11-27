import { Children, useEffect, useRef, useState, type ReactNode } from "react";
import {
  eventOccurrences,
  matchesInbox,
  type CalendarEvent,
  type Inbox,
  type Item,
  type Project,
} from "@organify/core";
import { Button } from "@/components/ui/button";
import { InterfaceIcon } from "./interface-icon";
import { calendarZone } from "./events";
import type { ConnectedWorkspace } from "./workspace-connection";
import type { DashboardWidgetId } from "./view-preferences";

function SectionPreferences({
  label,
  rows,
  onChange,
}: {
  label: string;
  rows: number;
  onChange: (rows: number) => void;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !details.current?.contains(event.target)
      ) {
        details.current?.removeAttribute("open");
      }
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, []);
  return (
    <details
      ref={details}
      className="dashboard-customizer"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          details.current?.removeAttribute("open");
          details.current?.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        className="topbar-button gap-2 px-3"
        aria-label={`Preferencias de ${label}`}
      >
        <InterfaceIcon name="filter" />
        Preferencias
      </summary>
      <div className="dashboard-customizer-popover">
        <label className="flex-wrap justify-between">
          Filas visibles
          <select
            className="field"
            aria-label={`Filas visibles de ${label}`}
            value={rows}
            onChange={(event) => onChange(Number(event.target.value))}
          >
            <option value={0}>Sin límite</option>
            {[1, 2, 3, 4, 5].map((count) => (
              <option key={count} value={count}>
                {count} {count === 1 ? "fila" : "filas"}
              </option>
            ))}
          </select>
        </label>
      </div>
    </details>
  );
}

function LimitedCardGrid({
  rows,
  label,
  children,
}: {
  rows: number;
  label: string;
  children: ReactNode;
}) {
  const grid = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(1);
  const [expanded, setExpanded] = useState(false);
  const cards = Children.toArray(children);
  useEffect(() => {
    const element = grid.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const tracks = getComputedStyle(element).gridTemplateColumns.split(" ");
      setColumns(Math.max(1, tracks.length));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const limit = rows ? rows * columns : cards.length;
  return (
    <>
      <div
        ref={grid}
        className="dashboard-card-grid"
        role="list"
        aria-label={label}
      >
        {expanded ? cards : cards.slice(0, limit)}
      </div>
      {cards.length > limit && (
        <button
          type="button"
          className="dashboard-widget-link mt-3"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Mostrar menos" : `Ver todos (${cards.length})`}
        </button>
      )}
    </>
  );
}

const widgetOptions: { id: DashboardWidgetId; label: string }[] = [
  { id: "today", label: "Tareas para hoy" },
  { id: "in-progress", label: "En curso" },
  { id: "agenda", label: "Agenda" },
  { id: "calendar", label: "Calendario" },
];

const weekdayLabels = ["L", "M", "X", "J", "V", "S", "D"];
const monthFormat = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  year: "numeric",
});
const dateFormat = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
});
const timeFormat = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: calendarZone,
});

function WorkspaceCard({
  name,
  description,
  ownerLabel,
  selected,
  image,
  coverIndex,
  onClick,
}: {
  name: string;
  description: string;
  ownerLabel: string;
  selected: boolean;
  image: string;
  coverIndex: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="dashboard-card group workspace-card"
      aria-pressed={selected}
      onClick={onClick}
    >
      <span
        className={`dashboard-cover workspace-cover cover-variant-${coverIndex}`}
      >
        <img src={image} alt="" loading="lazy" />
        <span className="dashboard-cover-wash" />
        <span className="dashboard-cover-badge">
          <InterfaceIcon name="board" />
          {ownerLabel}
        </span>
        {selected && (
          <span className="dashboard-selected-badge" aria-hidden="true">
            <InterfaceIcon name="check" />
            Actual
          </span>
        )}
      </span>
      <span className="dashboard-card-copy">
        <span className="dashboard-card-title">{name}</span>
        <span className="dashboard-card-description">{description}</span>
      </span>
    </button>
  );
}

function ProjectCard({
  project,
  items,
  onClick,
}: {
  project: Project;
  items: Item[];
  onClick: () => void;
}) {
  const projectItems = items.filter((item) => item.projectId === project.id);
  const openItems = projectItems.filter((item) => item.status !== "done");
  const description = projectItems.length
    ? `${projectItems.length} ${projectItems.length === 1 ? "tarea" : "tareas"} · ${openItems.length} pendientes`
    : "Un espacio para organizar este proyecto";

  return (
    <button
      type="button"
      className="dashboard-card group project-card"
      onClick={onClick}
    >
      <span className="dashboard-cover project-cover">
        <img src="/project-cover.png" alt="" loading="lazy" />
        <span className="dashboard-cover-wash" />
        <span
          className="project-cover-mark"
          style={{ backgroundColor: project.color || "var(--primary)" }}
        />
      </span>
      <span className="dashboard-card-copy">
        <span className="dashboard-card-title">{project.name}</span>
        <span className="dashboard-card-description">{description}</span>
      </span>
    </button>
  );
}

function TaskWidget({
  title,
  items,
  now,
  inbox,
  onOpen,
}: {
  title: string;
  items: Item[];
  now: Date;
  inbox: Inbox;
  onOpen: () => void;
}) {
  const matching = items
    .filter((item) => item.status !== "done" && matchesInbox(item, inbox, now))
    .slice(0, 4);

  return (
    <article className="dashboard-widget">
      <div className="dashboard-widget-heading">
        <div className="dashboard-widget-icon">
          <InterfaceIcon name={inbox === "today" ? "sun" : "clock"} />
        </div>
        <div className="min-w-0">
          <h3>{title}</h3>
          <p>
            {matching.length
              ? `${matching.length} a la vista`
              : "Tu espacio está despejado"}
          </p>
        </div>
      </div>
      {matching.length ? (
        <ul className="dashboard-task-list">
          {matching.map((item) => (
            <li key={item.id}>
              <span className={`dashboard-status-dot status-${item.status}`} />
              <span className="truncate">{item.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dashboard-widget-empty">
          {inbox === "today"
            ? "No hay tareas para hoy."
            : "No hay tareas en curso ahora."}
        </p>
      )}
      <button type="button" className="dashboard-widget-link" onClick={onOpen}>
        Ver tareas{" "}
        <InterfaceIcon name="chevron" className="size-3.5 -rotate-90" />
      </button>
    </article>
  );
}

function AgendaWidget({
  events,
  now,
  onOpen,
}: {
  events: CalendarEvent[];
  now: Date;
  onOpen: () => void;
}) {
  const rangeStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const rangeEnd = new Date(rangeStart);
  rangeEnd.setDate(rangeEnd.getDate() + 14);
  const upcoming = eventOccurrences(events, rangeStart, rangeEnd, calendarZone)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
    .slice(0, 3);

  return (
    <article className="dashboard-widget">
      <div className="dashboard-widget-heading">
        <div className="dashboard-widget-icon">
          <InterfaceIcon name="calendar" />
        </div>
        <div className="min-w-0">
          <h3>Agenda</h3>
          <p>Lo que viene en las próximas dos semanas</p>
        </div>
      </div>
      {upcoming.length ? (
        <ul className="dashboard-agenda-list">
          {upcoming.map((occurrence) => (
            <li key={occurrence.id}>
              <time dateTime={occurrence.start}>
                {occurrence.event.timing.allDay
                  ? dateFormat.format(new Date(`${occurrence.start}T12:00:00`))
                  : `${dateFormat.format(new Date(occurrence.start))} · ${timeFormat.format(new Date(occurrence.start))}`}
              </time>
              <span className="truncate">{occurrence.segment.title}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="dashboard-widget-empty">
          Todavía no hay eventos en la agenda.
        </p>
      )}
      <button type="button" className="dashboard-widget-link" onClick={onOpen}>
        Abrir agenda{" "}
        <InterfaceIcon name="chevron" className="size-3.5 -rotate-90" />
      </button>
    </article>
  );
}

function CalendarWidget({ now, onOpen }: { now: Date; onOpen: () => void }) {
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
  const leadingDays = (firstDay.getDay() + 6) % 7;
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0,
  ).getDate();
  const cells: { key: string; day?: number }[] = [
    ...Array.from({ length: leadingDays }, (_, index) => ({
      key: `empty-${index}`,
    })),
    ...Array.from({ length: daysInMonth }, (_, index) => ({
      day: index + 1,
      key: `day-${index + 1}`,
    })),
  ];

  return (
    <article className="dashboard-widget">
      <div className="dashboard-widget-heading">
        <div className="dashboard-widget-icon">
          <InterfaceIcon name="calendar" />
        </div>
        <div className="min-w-0">
          <h3>Calendario</h3>
          <p>{monthFormat.format(now)}</p>
        </div>
      </div>
      <div
        className="dashboard-calendar-grid"
        aria-label={monthFormat.format(now)}
      >
        {weekdayLabels.map((label, index) => (
          <span
            key={`${label}-${index}`}
            className="dashboard-calendar-weekday"
          >
            {label}
          </span>
        ))}
        {cells.map(({ day, key }) => (
          <span
            key={key}
            className={`dashboard-calendar-day ${day === now.getDate() ? "is-today" : ""}`}
            aria-current={day === now.getDate() ? "date" : undefined}
          >
            {day}
          </span>
        ))}
      </div>
      <button type="button" className="dashboard-widget-link" onClick={onOpen}>
        Ver calendario{" "}
        <InterfaceIcon name="chevron" className="size-3.5 -rotate-90" />
      </button>
    </article>
  );
}

export function HomeDashboard({
  spaces,
  selectedSpaceId,
  projects,
  items,
  events,
  now,
  loading,
  error,
  widgets,
  onWidgetsChange,
  canAddWorkspace,
  onSelectSpace,
  onSelectProject,
  onAddWorkspace,
  onAddProject,
  workspaceRows,
  projectRows,
  onWorkspaceRowsChange,
  onProjectRowsChange,
  onOpenInbox,
  onOpenAgenda,
  onOpenCalendar,
}: {
  spaces: ConnectedWorkspace[];
  selectedSpaceId?: string;
  projects: Project[];
  items: Item[];
  events: CalendarEvent[];
  now: Date;
  loading: boolean;
  error: boolean;
  widgets: DashboardWidgetId[];
  onWidgetsChange: (widgets: DashboardWidgetId[]) => void;
  canAddWorkspace: boolean;
  onSelectSpace: (id?: string) => void;
  onSelectProject: (id: string) => void;
  onAddWorkspace: () => void;
  onAddProject: () => void;
  workspaceRows: number;
  projectRows: number;
  onWorkspaceRowsChange: (rows: number) => void;
  onProjectRowsChange: (rows: number) => void;
  onOpenInbox: (inbox: "today" | "in-progress") => void;
  onOpenAgenda: () => void;
  onOpenCalendar: () => void;
}) {
  const toggleWidget = (id: DashboardWidgetId) =>
    onWidgetsChange(
      widgets.includes(id)
        ? widgets.filter((widget) => widget !== id)
        : [...widgets, id],
    );

  return (
    <div className="dashboard-page">
      <section
        className="dashboard-section"
        aria-labelledby="workspace-section-title"
      >
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-eyebrow">TU EQUIPO Y TUS IDEAS</p>
            <h2 id="workspace-section-title">Espacios de trabajo</h2>
          </div>
          <div className="dashboard-actions">
            <SectionPreferences
              label="Espacios de trabajo"
              rows={workspaceRows}
              onChange={onWorkspaceRowsChange}
            />
            <Button
              type="button"
              className="gap-2"
              onClick={onAddWorkspace}
              title={
                !canAddWorkspace
                  ? "Conecta una cuenta para añadir espacios compartidos"
                  : undefined
              }
            >
              <InterfaceIcon name="plus" data-icon="inline-start" />
              Añadir espacio
            </Button>
          </div>
        </div>
        <LimitedCardGrid
          key={`spaces-${workspaceRows}`}
          rows={workspaceRows}
          label="Tus espacios de trabajo"
        >
          <div role="listitem">
            <WorkspaceCard
              name="Personal"
              description="Tu espacio privado para las tareas de cada día."
              ownerLabel="Solo para ti"
              selected={!selectedSpaceId}
              image="/workspace-cover.png"
              coverIndex={0}
              onClick={() => onSelectSpace(undefined)}
            />
          </div>
          {spaces.map((space, index) => (
            <div role="listitem" key={space.membershipId}>
              <WorkspaceCard
                name={space.name}
                description={
                  space.owner
                    ? "Coordina el trabajo y los proyectos de tu equipo."
                    : "Un espacio compartido para colaborar y organizarse."
                }
                ownerLabel={
                  space.owner ? "Eres propietario" : "Compartido contigo"
                }
                selected={selectedSpaceId === space.id}
                image="/workspace-cover.png"
                coverIndex={(index + 1) % 3}
                onClick={() => onSelectSpace(space.id)}
              />
            </div>
          ))}
        </LimitedCardGrid>
        {loading && (
          <p className="dashboard-inline-note" role="status">
            Cargando espacios…
          </p>
        )}
        {error && (
          <p className="dashboard-inline-note" role="status">
            No se pudieron actualizar los espacios compartidos.
          </p>
        )}
      </section>

      <section
        className="dashboard-section"
        aria-labelledby="projects-section-title"
      >
        <div className="dashboard-section-heading">
          <div>
            <h2 id="projects-section-title">Proyectos</h2>
          </div>
          <div className="dashboard-actions">
            <span className="dashboard-section-meta">
              {projects.length}{" "}
              {projects.length === 1 ? "proyecto" : "proyectos"}
            </span>
            <SectionPreferences
              label="Proyectos"
              rows={projectRows}
              onChange={onProjectRowsChange}
            />
            <Button type="button" className="gap-2" onClick={onAddProject}>
              <InterfaceIcon name="plus" data-icon="inline-start" />
              Añadir proyecto
            </Button>
          </div>
        </div>
        {projects.length ? (
          <LimitedCardGrid
            key={`projects-${selectedSpaceId}-${projectRows}`}
            rows={projectRows}
            label="Proyectos de este espacio"
          >
            {projects.map((project) => (
              <div role="listitem" key={project.id}>
                <ProjectCard
                  project={project}
                  items={items}
                  onClick={() => onSelectProject(project.id)}
                />
              </div>
            ))}
          </LimitedCardGrid>
        ) : (
          <div className="dashboard-empty-projects">
            <span className="dashboard-empty-icon">
              <InterfaceIcon name="board" />
            </span>
            <div>
              <h3>Aún no hay proyectos en este espacio</h3>
              <p>
                Cuando crees un proyecto, aparecerá aquí junto a sus tareas.
              </p>
            </div>
          </div>
        )}
      </section>

      <section
        className="dashboard-section dashboard-personal-section"
        aria-labelledby="personal-panel-title"
      >
        <div className="dashboard-section-heading">
          <div>
            <p className="dashboard-eyebrow">TU VISTA, A TU RITMO</p>
            <h2 id="personal-panel-title">Tu panel personal</h2>
          </div>
          <details className="dashboard-customizer">
            <summary className="topbar-button gap-2 px-3">
              <InterfaceIcon name="brush" />
              Personalizar
            </summary>
            <div className="dashboard-customizer-popover">
              <p>Elige qué módulos quieres ver</p>
              {widgetOptions.map(({ id, label }) => (
                <label key={id}>
                  <input
                    type="checkbox"
                    checked={widgets.includes(id)}
                    onChange={() => toggleWidget(id)}
                  />
                  {label}
                </label>
              ))}
            </div>
          </details>
        </div>
        {widgets.length ? (
          <div className="dashboard-widget-grid">
            {widgets.map((widget) => (
              <div key={widget}>
                {widget === "today" && (
                  <TaskWidget
                    title="Tareas para hoy"
                    items={items}
                    now={now}
                    inbox="today"
                    onOpen={() => onOpenInbox("today")}
                  />
                )}
                {widget === "in-progress" && (
                  <TaskWidget
                    title="En curso"
                    items={items}
                    now={now}
                    inbox="in-progress"
                    onOpen={() => onOpenInbox("in-progress")}
                  />
                )}
                {widget === "agenda" && (
                  <AgendaWidget
                    events={events}
                    now={now}
                    onOpen={onOpenAgenda}
                  />
                )}
                {widget === "calendar" && (
                  <CalendarWidget now={now} onOpen={onOpenCalendar} />
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty-widgets">
            <p>
              Tu panel está vacío. Añade un módulo para empezar a
              personalizarlo.
            </p>
            <Button
              type="button"
              className="border border-line bg-paper text-foreground hover:bg-panel"
              onClick={() => toggleWidget("today")}
            >
              Añadir tareas para hoy
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
