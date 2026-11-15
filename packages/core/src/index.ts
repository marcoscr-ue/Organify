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
  order: string;
  archived?: boolean;
  deletedAt?: string;
}

export type NewItem = Pick<Item, "title" | "projectId" | "start" | "allDay">;
export type ItemChanges = Partial<Pick<Item, "title" | "notes" | "projectId">>;

export type Inbox = "all" | "today" | "upcoming" | "undated";

export function matchesInbox(item: Item, inbox: Inbox, now: Date): boolean {
  if (inbox === "all") return true;
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
