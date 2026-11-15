import type {
  Id,
  Item,
  ItemChanges,
  NewItem,
  Project,
  Status,
  Op,
} from "@organify/core";

export interface TaskSnapshot {
  items: Item[];
  projects: Project[];
}

export interface TaskRepositories {
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
    move(id: Id, status: Status): Promise<void>;
    remove(id: Id): Promise<void>;
  };
  projects: {
    create(name: string): Promise<Id>;
  };
}

export { createTaskRepositories } from "./dexie-repositories";
