import { describe, expect, it } from "vitest";
import { matchesInbox, type Item } from "../src/index";

const item: Item = {
  id: "item",
  workspaceId: "workspace",
  title: "Tarea",
  status: "todo",
  order: "a0",
  tagIds: [],
  props: {},
  notes: "",
};
const now = new Date(2026, 10, 15, 12);
const startOfToday = new Date(2026, 10, 15).toISOString();
const startOfTomorrow = new Date(2026, 10, 16).toISOString();

describe("matchesInbox", () => {
  it("separa Hoy y Próximas en la medianoche local", () => {
    expect(matchesInbox({ ...item, start: startOfToday }, "today", now)).toBe(
      true,
    );
    expect(
      matchesInbox({ ...item, start: startOfTomorrow }, "today", now),
    ).toBe(false);
    expect(
      matchesInbox({ ...item, start: startOfTomorrow }, "upcoming", now),
    ).toBe(true);
  });

  it("usa el vencimiento cuando no hay inicio y distingue tareas sin fecha", () => {
    expect(matchesInbox({ ...item, due: startOfToday }, "today", now)).toBe(
      true,
    );
    expect(matchesInbox(item, "undated", now)).toBe(true);
    expect(matchesInbox(item, "all", now)).toBe(true);
  });

  it("muestra una tarea desde el inicio hasta el fin de su duración estimada", () => {
    const start = now.toISOString();
    const scheduled = { ...item, start, props: { estimatedMinutes: 30 } };
    expect(matchesInbox(scheduled, "in-progress", new Date(+now - 1))).toBe(
      false,
    );
    expect(matchesInbox(scheduled, "in-progress", now)).toBe(true);
    expect(
      matchesInbox(scheduled, "in-progress", new Date(+now + 1_799_999)),
    ).toBe(true);
    expect(
      matchesInbox(scheduled, "in-progress", new Date(+now + 1_800_000)),
    ).toBe(false);
  });

  it("excluye tareas completadas, de día completo o sin inicio y estimación", () => {
    const start = now.toISOString();
    const props = { estimatedMinutes: 30 };
    const excluded: Item[] = [
      { ...item, start },
      { ...item, start, props: { spentMinutes: 30 } },
      { ...item, due: start, props },
      { ...item, start, props, allDay: true },
      { ...item, start, props, status: "done" },
    ];
    for (const task of excluded)
      expect(matchesInbox(task, "in-progress", now)).toBe(false);
  });
});
