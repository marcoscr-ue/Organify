import { expect, it } from "vitest";
import { mergeOp, type Op, type Project, type Replica } from "@organify/core";
import { materialize, record, type JournalTables } from "../src/journal";

it("sincroniza título y color al crear un proyecto con operaciones del protocolo 1", async () => {
  const settings = new Map<string, { key: string; value: string }>();
  const replicas = new Map<string, { key: string; state: Replica }>();
  const ops: Op[] = [];
  const source = {
    settings: {
      get: async (key: string) => settings.get(key),
      put: async (row: { key: string; value: string }) =>
        settings.set(row.key, row),
    },
    replicas: {
      get: async (key: string) => replicas.get(key),
      put: async (row: { key: string; state: Replica }) =>
        replicas.set(row.key, row),
    },
    outbox: { bulkAdd: async (entries: Op[]) => ops.push(...entries) },
  } as unknown as JournalTables;
  const project: Project = {
    id: "project-1",
    workspaceId: "personal",
    name: "Proyecto con color",
    color: "#ab12ef",
    order: "a0",
  };
  await record(source, "project", project);
  expect(ops.every((op) => op.v === 1 && op.entity === "project")).toBe(true);
  expect(ops).toContainEqual(
    expect.objectContaining({ field: "color", value: project.color }),
  );

  const received = new Map<string, Project>();
  const target = {
    projects: { put: async (row: Project) => received.set(row.id, row) },
  } as unknown as JournalTables;
  let state: Replica = { fields: {} };
  for (const op of [...ops].reverse()) {
    state = mergeOp(state, op);
    await materialize(target, op, state);
  }
  expect(received.get(project.id)).toMatchObject(project);
});
