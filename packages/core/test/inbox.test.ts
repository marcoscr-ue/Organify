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
});
