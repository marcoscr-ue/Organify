import { expect, it } from "vitest";
import type { Item } from "@organify/core";
import { scheduleChanges, shiftSeries } from "./calendar-schedule";

it("desplaza la serie según la diferencia local entre las ocurrencias", () => {
  const anchor = new Date(2026, 2, 22, 9, 30);
  const from = new Date(2026, 2, 29, 9, 30);
  const to = new Date(2026, 2, 30, 11, 45);
  expect(shiftSeries(anchor, from, to)).toEqual(new Date(2026, 2, 23, 11, 45));
});

it("conserva el vencimiento como campo de fecha para una tarea que solo tiene vencimiento", () => {
  const item: Pick<Item, "start" | "due"> = { due: "2026-11-15T09:00:00.000Z" };
  const date = new Date("2026-11-16T09:00:00.000Z");
  expect(scheduleChanges(item, date, false, "FREQ=WEEKLY")).toEqual({
    due: date.toISOString(),
    allDay: false,
    recurrence: "FREQ=WEEKLY",
  });
  expect(scheduleChanges(item, undefined, false)).toEqual({
    start: undefined,
    due: undefined,
    allDay: undefined,
    recurrence: undefined,
  });
});
