import { expect, it } from "vitest";
import {
  mergeOp,
  routineProgress,
  type Json,
  type Op,
  type Replica,
} from "../../core/src";
import { createOpCodec } from "../../crypto/src";
import { materialize, type JournalTables } from "../src/journal";
import { readRoutine } from "../src/routine-journal";

it("reconstruye una rutina cifrada desde el diario y combina marcas de dos dispositivos", async () => {
  const entityId = "routine/1";
  const codec = createOpCodec("test", new Uint8Array(32));
  const data: [field: string, value: Json, deviceId: string][] = [
    ["routine:name", "Revisión semanal", "a"],
    ["routine:start", "2026-11-20", "a"],
    ["routine:zone", "Europe/Madrid", "a"],
    [
      "routine:schedule:2026-11-20",
      {
        frequency: "weekly",
        steps: [
          { id: "review", label: "Revisar tareas" },
          { id: "plan", label: "Planificar la semana" },
        ],
      },
      "a",
    ],
    ["routine:check:2026-11-20:review", true, "a"],
    ["routine:check:2026-11-20:plan", true, "b"],
    ["routine:check:2026-11-20:review", true, "b"],
    ["routine:projectId", "project/1", "b"],
  ];
  const changes = await Promise.all(
    data.map(async ([field, value, deviceId], index) => {
      const op: Op = {
        id: String(index),
        deviceId,
        hlc: `1:${index}`,
        v: 1,
        entity: "item",
        entityId,
        kind: "set",
        field,
        value,
      };
      return codec.open({
        opId: op.id,
        deviceId,
        ciphertext: await codec.seal(op),
      });
    }),
  );
  let legacyReplica: Replica = { fields: {} };
  // The 0.9 materializer is unchanged. No legacy task or project table
  // should receive a write for these operations.
  for (const op of changes) {
    legacyReplica = mergeOp(legacyReplica, op);
    await materialize({} as JournalTables, op, legacyReplica);
  }
  const reversed = [...changes]
    .reverse()
    .reduce<Replica>(mergeOp, { fields: {} });
  const key = "item:" + entityId;
  const routine = readRoutine(key, legacyReplica);
  expect(routine).toEqual(readRoutine(key, reversed));
  if (!routine) throw new Error("No se reconstruyó la rutina.");
  expect(routine.projectId).toBe("project/1");
  const progress = routineProgress(routine, Date.parse("2026-11-22T12:00Z"));
  expect(progress.cycle.checked).toEqual(new Set(["review", "plan"]));
  expect(progress.cycle.complete).toBe(true);
  expect(progress.streak).toBe(1);
  const detached = readRoutine(
    key,
    mergeOp(legacyReplica, {
      v: 1,
      id: "detach",
      entityId,
      entity: "item",
      deviceId: "b",
      hlc: "2:0",
      kind: "set",
      field: "routine:projectId",
      value: null,
    }),
  );
  expect(detached?.projectId).toBeUndefined();
  expect(detached?.checks).toEqual(routine.checks);
});
