export function parseHlc(hlc: string): [number, number] {
  const values = hlc.split(":");
  const [wall, counter] = values.map(Number);
  if (
    !/^\d+:\d+$/.test(hlc) ||
    !Number.isSafeInteger(wall) ||
    !Number.isSafeInteger(counter) ||
    wall > 8.64e15
  )
    throw new Error("HLC inválido");
  return [wall, counter];
}

export function tickHlc(
  now: number,
  previous?: string,
  received?: string,
): string {
  const local = previous ? parseHlc(previous) : [-1, -1];
  const remote = received ? parseHlc(received) : [-1, -1];
  const wall = Math.max(now, local[0], remote[0]);
  const counter =
    1 +
    Math.max(
      local[0] === wall ? local[1] : -1,
      remote[0] === wall ? remote[1] : -1,
    );
  const hlc = wall + ":" + counter;
  parseHlc(hlc);
  return hlc;
}

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
interface OpBase {
  v: 1;
  id: string;
  deviceId: string;
  hlc: string;
  entity: "item" | "project";
  entityId: string;
}
type SetOp = OpBase & { kind: "set"; field: string; value: Json };
type DeleteOp = OpBase & { kind: "delete" };
export type Op = SetOp | DeleteOp;

export interface Replica {
  fields: Record<string, SetOp>;
  deletion?: DeleteOp;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareOps(a: Op, b: Op): number {
  const [wallA, countA] = parseHlc(a.hlc);
  const [wallB, countB] = parseHlc(b.hlc);
  return (
    wallA - wallB ||
    countA - countB ||
    compareText(a.deviceId, b.deviceId) ||
    compareText(a.id, b.id)
  );
}

export function mergeOp(state: Replica, op: Op): Replica {
  if (op.kind === "delete") {
    return state.deletion && compareOps(state.deletion, op) >= 0
      ? state
      : { ...state, deletion: op };
  }
  const current = Object.hasOwn(state.fields, op.field)
    ? state.fields[op.field]
    : undefined;
  return current && compareOps(current, op) >= 0
    ? state
    : {
        ...state,
        fields: { ...state.fields, [op.field]: op },
      };
}

export function replicaDeletedAt(state: Replica): string | undefined {
  const deletion = state.deletion;
  if (
    !deletion ||
    Object.values(state.fields).some((op) => compareOps(op, deletion) > 0)
  )
    return;
  return new Date(parseHlc(deletion.hlc)[0]).toISOString();
}

export function parseOp(value: unknown): Op {
  if (!value || typeof value !== "object")
    throw new Error("Operación inválida");
  const op = value as Record<string, unknown>;
  if (
    op.v !== 1 ||
    typeof op.id !== "string" ||
    typeof op.deviceId !== "string" ||
    typeof op.hlc !== "string" ||
    typeof op.entityId !== "string" ||
    (op.entity !== "item" && op.entity !== "project") ||
    (op.kind !== "delete" &&
      (op.kind !== "set" ||
        typeof op.field !== "string" ||
        !Object.hasOwn(op, "value")))
  )
    throw new Error("Operación inválida o versión incompatible");
  parseHlc(op.hlc);
  return value as Op;
}
