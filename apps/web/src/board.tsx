import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import {
  statuses,
  type Id,
  type Item,
  type Project,
  type Status,
} from "@organify/core";
import { statusLabels, TaskStatusIcon } from "./task-controls";

const collisionDetection: CollisionDetection = (args) =>
  args.pointerCoordinates ? pointerWithin(args) : closestCenter(args);

const columnCoordinates: KeyboardCoordinateGetter = (
  event,
  { context, currentCoordinates },
) => {
  if (event.code !== "ArrowLeft" && event.code !== "ArrowRight") return;
  event.preventDefault();
  const status = context.over?.id ?? context.active?.data.current?.status;
  const index = statuses.findIndex((value) => value === status);
  const next = statuses[index + (event.code === "ArrowLeft" ? -1 : 1)];
  const target = context.droppableRects.get(next);
  const current = context.collisionRect;
  if (index < 0 || !target || !current) return;

  return {
    x:
      currentCoordinates.x +
      target.left +
      (target.width - current.width) / 2 -
      current.left,
    y:
      currentCoordinates.y +
      target.top +
      (target.height - current.height) / 2 -
      current.top,
  };
};

function Card({
  item,
  project,
  now,
  open,
}: {
  item: Item;
  project?: Project;
  now: number;
  open: (id: Id) => void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    attributes,
    listeners,
    transform,
    isDragging,
  } = useDraggable({ id: item.id, data: { status: item.status } });

  return (
    <li
      ref={setNodeRef}
      className={`relative flex flex-wrap items-start gap-2 rounded-lg border border-line bg-paper p-3 shadow-xs ${isDragging ? "z-10" : ""}`}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
      }}
    >
      <div className="min-w-0 flex-1">
        <button
          type="button"
          className="block w-full wrap-anywhere text-left text-sm font-semibold hover:underline"
          onClick={() => open(item.id)}
        >
          {item.title}
        </button>
        {project && (
          <span className="mt-2 flex items-center gap-1.5 text-xs text-muted">
            <span
              aria-hidden="true"
              className="project-dot"
              style={{ backgroundColor: project.color }}
            />
            <span className="min-w-0 wrap-anywhere">{project.name}</span>
          </span>
        )}
      </div>
      <TaskStatusIcon item={item} now={now} />
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="touch-none cursor-grab rounded px-2 text-muted active:cursor-grabbing"
        {...attributes}
        {...listeners}
        aria-label={`Mover ${item.title}`}
      >
        <span aria-hidden="true">⠿</span>
      </button>
    </li>
  );
}

function Column({
  status,
  items,
  projects,
  now,
  open,
}: {
  status: Status;
  items: Item[];
  projects: ReadonlyMap<Id, Project>;
  now: number;
  open: (id: Id) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      className={`min-h-44 min-w-48 flex-1 rounded-lg border p-2.5 ${isOver ? "border-primary bg-tint" : "border-line bg-panel"}`}
    >
      <h2 className="mb-2 flex items-center justify-between gap-2 px-1 text-xs font-semibold text-muted">
        {statusLabels[status]}
        <span className="task-count">{items.length}</span>
      </h2>
      <ul className="grid gap-2">
        {items.map((item) => (
          <Card
            key={item.id}
            item={item}
            now={now}
            project={item.projectId ? projects.get(item.projectId) : undefined}
            open={open}
          />
        ))}
      </ul>
      {!items.length && (
        <p className="px-1 py-2 text-xs text-muted">Sin tareas</p>
      )}
    </section>
  );
}

export function Board({
  items,
  projects,
  now,
  open,
  move,
}: {
  items: Item[];
  projects: ReadonlyMap<Id, Project>;
  now: number;
  open: (id: Id) => void;
  move: (id: Id, status: Status) => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinates }),
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            "Pulsa Espacio para coger la tarjeta. Usa las flechas izquierda y derecha para cambiar de columna. Pulsa Espacio para soltar o Escape para cancelar.",
        },
      }}
      onDragEnd={({ active, over }) => {
        const status = statuses.find((value) => value === over?.id);
        if (status && typeof active.id === "string") move(active.id, status);
      }}
    >
      <div className="flex items-stretch gap-3 overflow-x-auto pb-3">
        {statuses.map((status) => (
          <Column
            key={status}
            status={status}
            items={items.filter((item) => item.status === status)}
            projects={projects}
            now={now}
            open={open}
          />
        ))}
      </div>
    </DndContext>
  );
}
