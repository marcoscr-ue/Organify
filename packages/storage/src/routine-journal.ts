import {
  isRoutineDate,
  isRoutineSchedule,
  routineDate,
  type Replica,
  type Routine,
} from "@organify/core";

// Legacy clients retain item fields in the journal. These IDs never materialize
// as tasks because they have no task fields.
export const routineKeyPrefix = "item:routine/";

export function readRoutine(
  key: string,
  { fields }: Replica,
): Routine | undefined {
  const name = fields["routine:name"]?.value;
  const projectId = fields["routine:projectId"]?.value;
  const startsOn = fields["routine:start"]?.value;
  const timeZone = fields["routine:zone"]?.value;
  if (
    fields["routine:removed"]?.value === true ||
    typeof name !== "string" ||
    typeof startsOn !== "string" ||
    !isRoutineDate(startsOn) ||
    typeof timeZone !== "string"
  )
    return;

  try {
    routineDate(0, timeZone);
  } catch {
    return;
  }

  const routine: Routine = {
    id: key.slice("item:".length),
    name,
    ...(typeof projectId === "string" && { projectId }),
    startsOn,
    timeZone,
    schedules: {},
    pauses: {},
    checks: {},
  };
  for (const { field, value } of Object.values(fields)) {
    const [prefix, kind, date, step] = field.split(":");
    if (
      prefix !== "routine" ||
      !date ||
      date < startsOn ||
      !isRoutineDate(date)
    )
      continue;
    if (kind === "schedule" && isRoutineSchedule(value))
      routine.schedules[date] = value;
    if (kind === "pause" && typeof value === "boolean")
      routine.pauses[date] = value;
    if (kind === "check" && step && value === true)
      (routine.checks[date] ??= new Set()).add(step);
  }
  if (routine.schedules[startsOn]) return routine;
}
