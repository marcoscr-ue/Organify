import type {
  Id,
  Item,
  ItemChanges,
  NewItem,
  Inbox,
  Project,
  ProjectChanges,
  Status,
  Op,
  Routine,
  RoutineChanges,
  RoutineInput,
  CalendarEvent,
  EventInput,
  EventChanges,
} from "@organify/core";

export interface TaskSnapshot {
  items: Item[];
  projects: Project[];
  routines: Routine[];
  events: CalendarEvent[];
}

export interface SavedView {
  id: Id;
  name: string;
  search: string;
  inbox: Inbox;
  projectId?: Id;
  status?: Status;
  layout: "list" | "board" | "calendar";
}

export interface TaskRepositories {
  events: {
    create(input: EventInput): Promise<Id>;
    update(
      id: Id,
      changes: Partial<Omit<EventInput, "recurrence">>,
    ): Promise<void>;
    remove(id: Id): Promise<void>;
    updateOccurrence(
      id: Id,
      originalStart: string,
      changes: EventChanges,
    ): Promise<void>;
    cancelOccurrence(id: Id, originalStart: string): Promise<void>;
  };
  routines: {
    create(input: RoutineInput): Promise<Id>;
    update(id: Id, changes: RoutineChanges): Promise<void>;
    setPaused(id: Id, paused: boolean): Promise<void>;
    setStep(
      id: Id,
      cycle: string,
      step: string,
      checked: boolean,
    ): Promise<void>;
    remove(id: Id): Promise<void>;
  };
  documents: {
    subscribe(
      id: Id,
      next: (state: Uint8Array | undefined) => void,
      error: (error: unknown) => void,
    ): () => void;
    append(id: Id, update: Uint8Array): Promise<void>;
  };
  views: {
    subscribe(
      next: (views: SavedView[]) => void,
      error: (error: unknown) => void,
    ): () => void;
    save(view: Omit<SavedView, "id">): Promise<Id>;
    remove(id: Id): Promise<void>;
  };
  sync: {
    bind(userId: string): Promise<void>;
    pending(limit: number): Promise<Op[]>;
    acknowledge(ids: string[]): Promise<void>;
    cursor(): Promise<string>;
    apply(ops: Op[], cursor: string): Promise<void>;
  };
  subscribe(
    next: (snapshot: TaskSnapshot) => void,
    error: (error: unknown) => void,
  ): () => void;
  items: {
    create(input: NewItem): Promise<Id>;
    update(id: Id, changes: ItemChanges): Promise<void>;
    setProperty(
      id: Id,
      name: string,
      value: string | number | boolean | null,
    ): Promise<void>;
    move(id: Id, status: Status): Promise<void>;
    remove(id: Id): Promise<void>;
    removeMany(ids: readonly Id[]): Promise<void>;
  };
  projects: {
    create(name: string): Promise<Id>;
    update(id: Id, changes: ProjectChanges): Promise<void>;
  };
}

export { createTaskRepositories } from "./dexie-repositories";
export {
  createDeviceUnlockStore,
  type SavedDeviceUnlock,
} from "./device-unlock";
