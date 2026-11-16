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
  color,
  now,
  open,
}: {
  item: Item;
  color?: string;
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
      className={`relative flex items-start justify-between gap-2 rounded-lg border border-line bg-paper p-3 shadow-xs ${isDragging ? "z-10" : ""}`}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        borderInlineStart: color ? `3px solid ${color}` : undefined,
      }}
    >
      <button
        type="button"
        className="min-w-0 flex-1 break-words text-left font-medium hover:underline"
        onClick={() => open(item.id)}
      >
        {item.title}
      </button>
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
      className={`min-h-56 min-w-56 flex-1 rounded-xl border p-3 ${isOver ? "border-primary bg-tint" : "border-line bg-panel"}`}
    >
      <h2 className="mb-4 flex justify-between gap-2 font-semibold">
        {statusLabels[status]}
        <span className="font-normal text-muted">{items.length}</span>
      </h2>
      <ul className="grid gap-2">
        {items.map((item) => (
          <Card
            key={item.id}
            item={item}
            now={now}
            color={
              item.projectId ? projects.get(item.projectId)?.color : undefined
            }
            open={open}
          />
        ))}
      </ul>
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
