import { expect, it } from "vitest";
import { isOverdue } from "./task-deadline";

it("prioriza el vencimiento explícito y excluye las tareas hechas", () => {
  const start = "2026-11-15T08:00:00Z";
  const due = "2026-11-16T12:00:00Z";
  const now = Date.parse(due);
  expect(isOverdue({ status: "todo", start, due }, now)).toBe(false);
  expect(isOverdue({ status: "doing", start, due }, now + 1)).toBe(true);
  expect(isOverdue({ status: "done", start, due }, now + 1)).toBe(false);
  expect(isOverdue({ status: "todo", start }, now)).toBe(true);
  expect(
    isOverdue({ status: "todo", start, recurrence: "FREQ=DAILY" }, now),
  ).toBe(false);
});

it("mantiene vigentes las tareas de día completo hasta la medianoche local", () => {
  const start = new Date(2026, 10, 16).toISOString();
  const nextDay = new Date(2026, 10, 17).getTime();
  const item = { status: "todo", start, allDay: true } as const;
  expect(isOverdue(item, nextDay - 1)).toBe(false);
  expect(isOverdue(item, nextDay)).toBe(true);
});
