import { expect, it } from "vitest";
import {
  mergeOp,
  replicaDeletedAt,
  tickHlc,
  type Op,
  type Replica,
} from "../src/index";

const base = {
  v: 1,
  id: "1",
  entity: "item",
  entityId: "item",
  deviceId: "a",
  hlc: "10:0",
} as const;
const title: Op = { ...base, kind: "set", field: "title", value: "Tarea" };
const note: Op = {
  ...base,
  id: "2",
  deviceId: "b",
  kind: "set",
  field: "notes",
  value: "Nota",
};
const deletion: Op = { ...base, id: "3", hlc: "11:0", kind: "delete" };
const restore: Op = { ...title, id: "4", hlc: "11:1", value: "Restaurada" };
const replay = (ops: Op[]) => ops.reduce<Replica>(mergeOp, { fields: {} });

it("mantiene la causalidad con relojes que retroceden o divergen", () => {
  expect(tickHlc(9, "10:4")).toBe("10:5");
  expect(tickHlc(9, "10:4", "10:7")).toBe("10:8");
  expect(tickHlc(9, "10:4", "20:7")).toBe("20:8");
});

it("converge con orden distinto, duplicados y ediciones de campos independientes", () => {
  const ops = [title, note, deletion, restore];
  const expected = replay(ops);
  for (let index = 0; index < ops.length; index++) {
    const rotated = [...ops.slice(index), ...ops.slice(0, index)].reverse();
    expect(replay([...rotated, title])).toEqual(expected);
  }
  expect(replicaDeletedAt(replay([deletion, title, note]))).toBe(
    new Date(11).toISOString(),
  );
  expect(replicaDeletedAt(expected)).toBeUndefined();
});
