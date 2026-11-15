import { expect, it } from "vitest";
import { parseCapture } from "./quick-capture";

const now = new Date(2026, 10, 15, 11);

it("extrae una fecha y hora en español conservando el título", () => {
  expect(parseCapture("reunión con Ana mañana a las 10:00", now)).toEqual({
    title: "reunión con Ana",
    start: new Date(2026, 10, 16, 10).toISOString(),
    allDay: false,
  });
});

it("mantiene las capturas sin fecha y distingue el día completo", () => {
  expect(parseCapture("Comprar pan", now)).toEqual({ title: "Comprar pan" });
  expect(parseCapture("Comprar pan mañana", now)).toEqual({
    title: "Comprar pan",
    start: new Date(2026, 10, 16).toISOString(),
    allDay: true,
  });
});
