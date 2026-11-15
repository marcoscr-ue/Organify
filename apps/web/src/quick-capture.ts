import { es } from "chrono-node";
import type { NewItem } from "@organify/core";

export function parseCapture(input: string, now = new Date()): NewItem {
  const text = input.trim();
  const [match] = es.parse(text, now, { forwardDate: true });
  if (!match) return { title: text };

  const before = text.slice(0, match.index).trimEnd();
  const after = text.slice(match.index + match.text.length).trimStart();
  const allDay = !match.start.isCertain("hour");
  const start = match.start.date();
  if (allDay) start.setHours(0, 0, 0, 0);

  return {
    title: [before, after].filter(Boolean).join(" ") || text,
    start: start.toISOString(),
    allDay,
  };
}
