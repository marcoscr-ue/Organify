import { expect, it } from "vitest";
import { isOverdue } from "./task-deadline";

it("prioriza el vencimiento explícito y excluye las tareas hechas", () => {
  const start = "2026-11-15T08:00:00Z";
  const due = "2026-11-16T12:00:00Z";
  const now = Date.parse(due);
  const task = { status: "todo", start, props: {} } as const;
  expect(isOverdue({ ...task, due }, now)).toBe(false);
  expect(isOverdue({ ...task, status: "doing", due }, now + 1)).toBe(true);
  expect(isOverdue({ ...task, status: "done", due }, now + 1)).toBe(false);
  expect(isOverdue(task, now)).toBe(true);
  expect(isOverdue({ ...task, recurrence: "FREQ=DAILY" }, now)).toBe(false);
});

it("espera al fin de la duración estimada cuando no hay vencimiento explícito", () => {
  const start = "2026-11-15T08:00:00Z";
  const task = {
    status: "todo",
    start,
    props: { estimatedMinutes: 45, spentMinutes: 10 },
  } as const;
  const end = Date.parse("2026-11-15T08:45:00Z");
  expect(isOverdue(task, Date.parse(start) + 1)).toBe(false);
  expect(isOverdue(task, end)).toBe(false);
  expect(isOverdue(task, end + 1)).toBe(true);
  expect(isOverdue({ ...task, due: "2026-11-15T09:00:00Z" }, end + 1)).toBe(
    false,
  );
});

it("mantiene vigentes las tareas de día completo hasta la medianoche local", () => {
  const start = new Date(2026, 10, 16).toISOString();
  const nextDay = new Date(2026, 10, 17).getTime();
  const item = {
    status: "todo",
    start,
    allDay: true,
    props: { estimatedMinutes: 45 },
  } as const;
  expect(isOverdue(item, nextDay - 1)).toBe(false);
  expect(isOverdue(item, nextDay)).toBe(true);
});
