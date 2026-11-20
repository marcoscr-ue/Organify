import { useEffect, useState } from "react";
import { statuses, type Id, type Inbox, type Status } from "@organify/core";
import type { CalendarPosition } from "./calendar-view";
import { InterfaceIcon } from "./interface-icon";

declare global {
  interface Window {
    __TAURI__?: {
      window?: {
        getCurrentWindow: () => {
          label: string;
          isMaximized: () => Promise<boolean>;
          minimize: () => Promise<void>;
          toggleMaximize: () => Promise<void>;
          close: () => Promise<void>;
        };
      };
      core: {
        invoke: (
          command: string,
          args?: Record<string, unknown>,
        ) => Promise<unknown>;
      };
    };
  }
}

export const desktopWindow = window.__TAURI__?.window?.getCurrentWindow();

type FloatingView =
  | { kind: "task"; id: Id }
  | {
      kind: "board" | "calendar";
      inbox: Inbox;
      projectId?: Id;
      status?: Status;
      search: string;
      position?: CalendarPosition;
    };

export function readFloatingView(): FloatingView | undefined {
  if (!desktopWindow || desktopWindow.label === "main") return;
  const params = new URLSearchParams(location.hash.slice(1));
  const kind = params.get("floating");
  if (kind === "task") {
    const id = params.get("task");
    if (id) return { kind, id };
  }
  if (kind === "board" || kind === "calendar") {
    const inbox = params.get("inbox");
    const view = params.get("view");
    const date = params.get("date");
    return {
      kind,
      inbox:
        inbox === "today" || inbox === "upcoming" || inbox === "undated"
          ? inbox
          : "all",
      projectId: params.get("project") || undefined,
      status: statuses.find((status) => status === params.get("status")),
      search: params.get("search") ?? "",
      position: view && date ? { view, date } : undefined,
    };
  }
}

export async function openFloatingView(view: FloatingView, title?: string) {
  const params =
    view.kind === "task"
      ? { task: view.id }
      : {
          inbox: view.inbox,
          project: view.projectId ?? "",
          status: view.status ?? "",
          search: view.search,
          view: view.position?.view ?? "",
          date: view.position?.date ?? "",
        };
  const context = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) context.set(key, value);
  return window.__TAURI__?.core.invoke("open_floating_window", {
    kind: view.kind,
    taskId: view.kind === "task" ? view.id : null,
    title: title ?? null,
    context: context.toString(),
  });
}

export function FloatButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className="nav-link flex items-center gap-1.5 text-xs"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <InterfaceIcon name="popout" />
      Abrir en ventana
    </button>
  );
}

export function DesktopWindowControls() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const current = desktopWindow;
    if (!current) return;
    let active = true;
    function refresh() {
      void current
        ?.isMaximized()
        .then((value) => {
          if (active) setMaximized(value);
        })
        .catch(console.error);
    }
    refresh();
    window.addEventListener("resize", refresh);
    return () => {
      active = false;
      window.removeEventListener("resize", refresh);
    };
  }, []);
  const current = desktopWindow;
  if (!current) return null;
  const buttons = [
    { label: "Minimizar", path: "M0 5h10", run: () => current.minimize() },
    {
      label: maximized ? "Restaurar" : "Maximizar",
      path: maximized ? "M2 2V0h8v8H8M0 2h8v8H0z" : "M0 0h10v10H0z",
      run: async () => {
        await current.toggleMaximize();
        setMaximized(await current.isMaximized());
      },
    },
    {
      label: "Cerrar",
      path: "m0 0 10 10m0-10L0 10",
      run: () => current.close(),
    },
  ];
  return (
    <div
      role="group"
      aria-label="Controles de ventana"
      className="flex shrink-0 self-start"
    >
      {buttons.map(({ label, path, run }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          title={label}
          onClick={() => void run().catch(console.error)}
          className={`grid h-8 w-11 place-items-center focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary ${label === "Cerrar" ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-foreground/8"}`}
        >
          <svg
            aria-hidden="true"
            className="size-3"
            viewBox="-1 -1 12 12"
            fill="none"
            stroke="currentColor"
          >
            <path d={path} />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function DesktopSettings() {
  const [enabled, setEnabled] = useState<boolean>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void window.__TAURI__?.core
      .invoke("minimize_on_close")
      .then((value) => setEnabled(value === true))
      .catch(() => setError("No se pudo leer el ajuste de cierre."));
  }, []);

  async function update(next: boolean) {
    setBusy(true);
    setError("");
    try {
      const value = await window.__TAURI__?.core.invoke("minimize_on_close", {
        enabled: next,
      });
      setEnabled(value === true);
    } catch {
      setError("No se pudo guardar el ajuste de cierre.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3 text-sm">
      <label className="grid gap-1">
        Al cerrar la ventana principal
        <select
          className="field"
          value={enabled ? "minimize" : "quit"}
          disabled={enabled === undefined || busy}
          onChange={(event) => void update(event.target.value === "minimize")}
        >
          <option value="quit">Salir de Organify</option>
          <option value="minimize">
            Minimizar y seguir recibiendo recordatorios
          </option>
        </select>
      </label>
      <button
        type="button"
        className="nav-link justify-self-start"
        onClick={() =>
          void window.__TAURI__?.core
            .invoke("quit_organify")
            .catch(() => setError("No se pudo salir de Organify."))
        }
      >
        Salir de Organify ahora
      </button>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
