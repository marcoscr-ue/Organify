export type RoutineFrequency = "daily" | "weekly";

export interface RoutineStep {
  id: string;
  label: string;
}

export interface RoutineSchedule {
  frequency: RoutineFrequency;
  steps: RoutineStep[];
}

export interface RoutineInput extends RoutineSchedule {
  name: string;
}

export interface RoutineChanges {
  name?: string;
  schedule?: RoutineSchedule;
}

export interface Routine {
  id: string;
  name: string;
  timeZone: string;
  startsOn: string;
  schedules: Record<string, RoutineSchedule>;
  pauses: Record<string, boolean>;
  checks: Record<string, Set<string>>;
}

export interface RoutineCycle extends RoutineSchedule {
  start: string;
  end: string;
  paused: boolean;
  checked: ReadonlySet<string>;
  complete: boolean;
}

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const noChecks: ReadonlySet<string> = new Set();

export function routineDate(now: number, timeZone: string): string {
  let format = dateFormatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-CA", {
      calendar: "iso8601",
      numberingSystem: "latn",
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    dateFormatters.set(timeZone, format);
  }
  const parts = format.formatToParts(now);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function shiftRoutineDate(date: string, days: number): string {
  const utc = new Date(date + "T00:00:00Z");
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function isRoutineDate(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    shiftRoutineDate(value, 0) === value
  );
}

export function isRoutineSchedule(value: unknown): value is RoutineSchedule {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Partial<RoutineSchedule>;
  return (
    (schedule.frequency === "daily" || schedule.frequency === "weekly") &&
    Array.isArray(schedule.steps) &&
    schedule.steps.length > 0 &&
    schedule.steps.every(
      (step) =>
        step &&
        typeof step.id === "string" &&
        /^[\w-]+$/.test(step.id) &&
        typeof step.label === "string" &&
        !!step.label.trim(),
    ) &&
    new Set(schedule.steps.map((step) => step.id)).size ===
      schedule.steps.length
  );
}

function cycleEnd(start: string, frequency: RoutineFrequency) {
  const weekday = new Date(start + "T00:00:00Z").getUTCDay();
  return shiftRoutineDate(
    start,
    frequency === "daily" ? 1 : 7 - ((weekday + 6) % 7),
  );
}

export function routineProgress(routine: Routine, now: number) {
  const today = routineDate(now, routine.timeZone);
  const changes = [
    ...new Set([
      ...Object.keys(routine.schedules),
      ...Object.keys(routine.pauses),
    ]),
  ]
    .filter((date) => date > routine.startsOn)
    .sort();
  const history: RoutineCycle[] = [];
  let start = routine.startsOn;
  let schedule = routine.schedules[start];
  let paused = routine.pauses[start] ?? false;
  let streak = 0;
  let nextChange = 0;
  for (;;) {
    const updated = routine.schedules[start];
    if (updated && updated.frequency !== schedule.frequency) streak = 0;
    schedule = updated ?? schedule;
    paused = routine.pauses[start] ?? paused;
    while (nextChange < changes.length && changes[nextChange] <= start) {
      nextChange++;
    }
    const boundary = changes[nextChange];
    const scheduledEnd = cycleEnd(start, schedule.frequency);
    const end = boundary && boundary < scheduledEnd ? boundary : scheduledEnd;
    const checked = routine.checks[start] ?? noChecks;
    const complete =
      !paused && schedule.steps.every(({ id }) => checked.has(id));
    const cycle = { ...schedule, start, end, paused, checked, complete };

    if (today < end) {
      return {
        cycle,
        history: history.reverse(),
        streak: streak + Number(complete),
        started: today >= start,
        nextSchedule: routine.schedules[end] ?? schedule,
        nextPaused: routine.pauses[end] ?? paused,
      };
    }
    if (!paused) streak = complete ? streak + 1 : 0;
    history.push(cycle);
    start = end;
  }
}
