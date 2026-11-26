import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import type { Inbox } from "@organify/core";

export const inboxes = [
  { id: "today", label: "Hoy" },
  { id: "in-progress", label: "En curso" },
  { id: "all", label: "Todas" },
  { id: "upcoming", label: "Próximas" },
  { id: "undated", label: "Sin fecha" },
] as const satisfies ReadonlyArray<{ id: Inbox; label: string }>;

export const dashboardWidgetIds = [
  "today",
  "in-progress",
  "agenda",
  "calendar",
] as const;
export type DashboardWidgetId = (typeof dashboardWidgetIds)[number];

const defaultDashboardWidgets: DashboardWidgetId[] = [
  "today",
  "in-progress",
  "agenda",
];

export const startupViews = [
  { id: "home", label: "Inicio" },
  ...inboxes,
  { id: "board", label: "Tablero" },
  { id: "calendar", label: "Calendario" },
  { id: "routines", label: "Rutinas" },
  { id: "events", label: "Eventos" },
] as const;

export const fontSizes = [100, 110, 125] as const;

const storageKey = "organify.view-preferences";

function readPreferences() {
  let saved: Record<string, unknown> | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  } catch {
    // Use defaults if the stored preferences cannot be read.
  }
  const savedWidgets = Array.isArray(saved?.dashboardWidgets)
    ? saved.dashboardWidgets.filter(
        (widget): widget is DashboardWidgetId =>
          typeof widget === "string" &&
          dashboardWidgetIds.includes(widget as DashboardWidgetId),
      )
    : [...defaultDashboardWidgets];

  return {
    startupView:
      startupViews.find(({ id }) => id === saved?.startupView)?.id ?? "home",
    dashboardWidgets: [...new Set(savedWidgets)],
    hideTaskStatus: saved?.hideTaskStatus === true,
    fontSize: fontSizes.find((size) => size === saved?.fontSize) ?? 100,
    tasksInWindows: saved?.tasksInWindows === true,
  };
}

export const supportsFontSize = !Capacitor.isNativePlatform();

export function applyViewPreferences(
  { fontSize, hideTaskStatus } = readPreferences(),
) {
  const root = document.documentElement;
  root.style.fontSize =
    supportsFontSize && fontSize !== 100 ? `${fontSize}%` : "";
  root.toggleAttribute("data-hide-task-status", hideTaskStatus);
}

export function useViewPreferences() {
  const [values, setValues] = useState(readPreferences);

  useEffect(() => {
    function syncPreferences(event: StorageEvent) {
      if (event.key !== storageKey && event.key !== null) return;
      const next = readPreferences();
      applyViewPreferences(next);
      setValues(next);
    }
    window.addEventListener("storage", syncPreferences);
    return () => window.removeEventListener("storage", syncPreferences);
  }, []);

  function save(changes: Partial<typeof values>) {
    const next = { ...readPreferences(), ...changes };
    localStorage.setItem(storageKey, JSON.stringify(next));
    applyViewPreferences(next);
    setValues(next);
  }

  return { ...values, save };
}

export type ViewPreferences = ReturnType<typeof useViewPreferences>;
