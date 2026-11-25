import { expect, it } from "vitest";
import { eventOccurrences, isEventSchedule, type CalendarEvent } from "../src";

function series(event: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "event/1",
    groupId: "event/1",
    title: "Clase",
    notes: "",
    color: null,
    timing: {
      allDay: false,
      start: "2026-01-31T18:00",
      end: "2026-01-31T19:00",
      timeZone: "Europe/Madrid",
    },
    recurrence: { frequency: "monthly", interval: 1, until: "2026-05-31" },
    ...event,
  };
}

function between(
  event: CalendarEvent,
  start: string,
  end: string,
  zone = "UTC",
) {
  return eventOccurrences([event], new Date(start), new Date(end), zone);
}

it("omite meses sin el día previsto e incluye el último día en la zona de la serie", () => {
  const event = series({
    timing: {
      allDay: false,
      start: "2026-01-31T23:45",
      end: "2026-02-01T00:45",
      timeZone: "America/New_York",
    },
  });
  expect(
    between(event, "2026-01-01", "2026-07-01").map(({ start }) => start),
  ).toEqual([
    "2026-02-01T04:45:00.000Z",
    "2026-04-01T03:45:00.000Z",
    "2026-06-01T03:45:00.000Z",
  ]);
  const leap = series({
    timing: { allDay: true, start: "2027-01-29", end: "2027-01-30" },
    recurrence: { frequency: "monthly", interval: 1, until: null },
  });
  expect(between(leap, "2027-02-01", "2027-03-01")).toEqual([]);
  expect(
    between(leap, "2028-02-01", "2028-03-01").map(({ start }) => start),
  ).toEqual(["2028-02-29"]);
});

it("preserva el inicio previsto en el salto y el pliegue, y la duración de la serie", () => {
  const event = series({
    timing: {
      allDay: false,
      start: "2026-01-04T02:30",
      end: "2026-01-04T03:30",
      timeZone: "Europe/Madrid",
    },
    recurrence: { frequency: "weekly", interval: 1, until: null },
  });
  const spring = between(event, "2026-03-29", "2026-04-06");
  expect(
    spring.map(({ originalStart, start, end }) => [originalStart, start, end]),
  ).toEqual([
    [
      "2026-03-29T02:30",
      "2026-03-29T01:30:00.000Z",
      "2026-03-29T02:30:00.000Z",
    ],
    [
      "2026-04-05T02:30",
      "2026-04-05T00:30:00.000Z",
      "2026-04-05T01:30:00.000Z",
    ],
  ]);
  const [fall, ...rest] = between(event, "2026-10-24", "2026-10-26");
  expect(rest).toEqual([]);
  expect(fall?.start).toBe("2026-10-25T00:30:00.000Z");
  expect(fall?.id).toBe("event/1/2026-10-25T02:30");
});

it("mantiene las fechas civiles y muestra eventos que se solapan con el rango", () => {
  const event = series({
    timing: { allDay: true, start: "2026-03-28", end: "2026-03-31" },
    recurrence: null,
  });
  const madrid = between(
    event,
    "2026-03-29T22:00Z",
    "2026-03-30T22:00Z",
    "Europe/Madrid",
  );
  const tokyo = between(
    event,
    "2026-03-29T15:00Z",
    "2026-03-30T15:00Z",
    "Asia/Tokyo",
  );
  expect(madrid).toHaveLength(1);
  expect(tokyo).toEqual(madrid);
  expect(
    between(event, "2026-03-30T22:00Z", "2026-03-31T22:00Z", "Europe/Madrid"),
  ).toEqual([]);
  const timed = series({
    timing: {
      allDay: false,
      start: "2026-03-29T01:30",
      end: "2026-03-29T03:30",
      timeZone: "Europe/Madrid",
    },
    recurrence: null,
  });
  expect(between(timed, "2026-03-29T01:00Z", "2026-03-29T02:00Z")[0]?.end).toBe(
    "2026-03-29T01:30:00.000Z",
  );
});

it("mantiene la cadencia al consultar lejos del origen y valida los límites", () => {
  const event = series({
    timing: { allDay: true, start: "2026-01-01", end: "2026-01-02" },
    recurrence: { frequency: "daily", interval: 3, until: "2026-02-06" },
  });
  expect(
    between(event, "2026-02-01", "2026-03-01").map(({ start }) => start),
  ).toEqual(["2026-02-03", "2026-02-06"]);
  expect(isEventSchedule(event)).toBe(true);
  expect(
    isEventSchedule({
      ...event,
      recurrence: { ...event.recurrence, interval: 0 },
    }),
  ).toBe(false);
  expect(
    isEventSchedule({
      ...event,
      timing: { allDay: true, start: "2026-02-30", end: "2026-03-02" },
    }),
  ).toBe(false);
  const monthly = series({
    recurrence: { frequency: "monthly", interval: 2, until: null },
  });
  expect(
    between(monthly, "2026-05-01", "2026-08-01").map(
      ({ originalStart }) => originalStart,
    ),
  ).toEqual(["2026-05-31T18:00", "2026-07-31T18:00"]);
});
