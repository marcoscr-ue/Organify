export const statuses = ["todo", "doing", "done"] as const;
export type Status = (typeof statuses)[number];
export type Id = string;

export interface Item {
  id: Id;
  workspaceId: Id;
  title: string;
  status: Status;
  start?: string;
  due?: string;
  recurrence?: string;
  allDay?: boolean;
  projectId?: Id;
  order: string;
  tagIds: Id[];
  props: Record<string, unknown>;
  notes: string;
  deletedAt?: string;
}

export interface Project {
  id: Id;
  workspaceId: Id;
  name: string;
  color?: string;
  order: string;
  archived?: boolean;
  deletedAt?: string;
}

export type ProjectChanges = Partial<Pick<Project, "name" | "color">>;

export function isProjectColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

export type NewItem = Pick<Item, "title" | "projectId" | "start" | "allDay">;
export const taskDurationFields = ["estimatedMinutes", "spentMinutes"] as const;
type TaskDurationField = (typeof taskDurationFields)[number];

export function taskDuration(
  item: Pick<Item, "props">,
  field: TaskDurationField,
) {
  const value = item.props[field];
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= (field === "estimatedMinutes" ? 1 : 0)
    ? value
    : undefined;
}

export type ItemChanges = Partial<
  Pick<
    Item,
    "title" | "notes" | "projectId" | "start" | "due" | "allDay" | "recurrence"
  >
> &
  Partial<Record<TaskDurationField, number | undefined>>;

export type Inbox = "all" | "today" | "in-progress" | "upcoming" | "undated";

export function matchesInbox(
  item: Item,
  inbox: Inbox,
  now: Date,
  scheduledStart = item.start,
): boolean {
  if (inbox === "all") return true;
  if (inbox === "in-progress") {
    const duration = taskDuration(item, "estimatedMinutes");
    if (
      !scheduledStart ||
      !duration ||
      item.allDay ||
      item.status === "done" ||
      item.deletedAt
    )
      return false;
    const elapsed = now.getTime() - Date.parse(scheduledStart);
    return elapsed >= 0 && elapsed < duration * 60_000;
  }
  const date = item.start ?? item.due;
  if (!date) return inbox === "undated";
  if (inbox === "undated") return false;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const time = Date.parse(date);
  return inbox === "today"
    ? time >= today.getTime() && time < tomorrow.getTime()
    : time >= tomorrow.getTime();
}
export * from "./operations";
export * from "./routines";
export * from "./events";
