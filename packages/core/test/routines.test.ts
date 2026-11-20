import { expect, it } from "vitest";
import { routineProgress, type Routine, type RoutineSchedule } from "../src";

const steps = [
  { id: "read", label: "Leer" },
  { id: "write", label: "Escribir" },
];
const daily: RoutineSchedule = { frequency: "daily", steps };

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: "routine/test",
    name: "Lectura",
    timeZone: "Europe/Madrid",
    startsOn: "2026-10-24",
    schedules: { "2026-10-24": daily },
    pauses: {},
    checks: {},
    ...overrides,
  };
}

it("reinicia la checklist a medianoche local durante el cambio de hora", () => {
  const entry = routine({
    checks: { "2026-10-24": new Set(["read", "write"]) },
  });
  const before = routineProgress(entry, Date.parse("2026-10-24T21:59:59Z"));
  expect(before.cycle.complete).toBe(true);
  expect(before.streak).toBe(1);

  const after = routineProgress(entry, Date.parse("2026-10-24T22:00:00Z"));
  expect(after.cycle.start).toBe("2026-10-25");
  expect(after.cycle.checked.size).toBe(0);
  expect(after.streak).toBe(1);

  const missed = routineProgress(entry, Date.parse("2026-10-25T23:00:00Z"));
  expect(missed.cycle.start).toBe("2026-10-26");
  expect(missed.history.map((cycle) => cycle.complete)).toEqual([false, true]);
  expect(missed.streak).toBe(0);
});

it("abre una semana parcial al crear la rutina y aplica cambios al siguiente ciclo", () => {
  const entry = routine({
    startsOn: "2026-11-20",
    schedules: {
      "2026-11-20": { frequency: "weekly", steps },
      "2026-11-23": {
        frequency: "daily",
        steps: [{ id: "walk", label: "Pasear" }],
      },
    },
    checks: { "2026-11-20": new Set(["read", "write"]) },
  });
  const sunday = routineProgress(entry, Date.parse("2026-11-22T15:00:00Z"));
  expect(sunday.cycle).toMatchObject({
    start: "2026-11-20",
    end: "2026-11-23",
    steps,
  });
  expect(sunday.streak).toBe(1);

  const monday = routineProgress(entry, Date.parse("2026-11-23T15:00:00Z"));
  expect(monday.cycle).toMatchObject({ frequency: "daily", end: "2026-11-24" });
  expect(monday.history[0].steps).toEqual(steps);
  expect(monday.streak).toBe(0);
});

it("mantiene la racha en pausa y permite deshacer la finalización del ciclo abierto", () => {
  const entry = routine({
    pauses: { "2026-10-25": true, "2026-10-27": false },
    checks: {
      "2026-10-24": new Set(["read", "write"]),
      "2026-10-27": new Set(["read", "write"]),
    },
  });
  const paused = routineProgress(entry, Date.parse("2026-10-26T15:00:00Z"));
  expect(paused.cycle.paused).toBe(true);
  expect(paused.streak).toBe(1);

  const resumedAt = Date.parse("2026-10-27T15:00:00Z");
  expect(routineProgress(entry, resumedAt).streak).toBe(2);
  entry.checks["2026-10-27"].delete("write");
  expect(routineProgress(entry, resumedAt).streak).toBe(1);
});
