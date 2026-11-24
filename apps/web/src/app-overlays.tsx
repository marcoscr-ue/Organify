import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Capacitor } from "@capacitor/core";
import type { TaskRepositories } from "@organify/storage";
import { Button } from "@/components/ui/button";
import { version as desktopVersion } from "../../desktop/package.json";
import { version } from "../package.json";
import {
  DesktopPreference,
  ExperimentalUpdates,
  desktopWindow,
} from "./desktop-windows";
import { InterfaceIcon } from "./interface-icon";
import { PwaSettings } from "./pwa-settings";
import { ShortcutSettings } from "./shortcut-settings";
import { SyncSettings, type SyncStatus } from "./sync-settings";
import type { WorkspacePreferences } from "./workspace-shortcuts";
import {
  fontSizes,
  startupViews,
  supportsFontSize,
  type ViewPreferences,
} from "./view-preferences";

const introduced = (text: string) => ({ text, kind: "new" as const });
const updated = (text: string) => ({ text, kind: "updated" as const });
const improved = (text: string) => ({ text, kind: "improved" as const });

const releaseChangeStyles = {
  new: {
    order: 0,
    label: "¡Nuevo!",
    badge: "bg-danger/10 text-danger",
    dot: "bg-danger",
  },
  updated: {
    order: 1,
    label: "Actualizado",
    badge: "bg-tint text-accent-ink",
    dot: "bg-accent-ink",
  },
  improved: {
    order: 2,
    label: "Mejorado",
    badge: "bg-success-tint text-success",
    dot: "bg-success",
  },
};

type Release = {
  version: string;
  date: string;
  label?: string;
  windowsOnly?: boolean;
  changes: Array<
    ReturnType<typeof introduced | typeof updated | typeof improved> & {
      windowsOnly?: boolean;
    }
  >;
};

const releases: Release[] = [
  {
    version: "0.14.0",
    date: "2026-11-24",
    changes: [
      introduced(
        "Instala Organify como aplicación web progresiva (PWA) y accede a ella desde el móvil.",
      ),
      introduced(
        "Elige la vista inicial y oculta los iconos de las tareas completadas y vencidas.",
      ),
      introduced("Ahora puedes aumentar el tamaño de la letra desde Ajustes."),
      {
        ...introduced(
          "Inicia Organify con la ventana maximizada, abre tareas directamente en ventanas independientes y prueba las actualizaciones experimentales desde Avanzado.",
        ),
        windowsOnly: true,
      },
      updated(
        "El modo de instalación móvil por APK será descontinuado a partir de esta versión. Instala Organify como PWA desde el navegador en Ajustes.",
      ),
    ],
  },
  {
    version: "0.13.0",
    date: "2026-11-22",
    changes: [
      introduced(
        "Añade una duración estimada y registra manualmente el tiempo empleado en cada tarea.",
      ),
      introduced(
        "En curso muestra las tareas pendientes cuyo horario previsto está activo.",
      ),
    ],
  },
  {
    version: "0.12.0",
    date: "2026-11-22",
    changes: [
      introduced(
        "En Web y Windows, usa E, R y D sobre tareas y rutinas, y N para crear en la pestaña activa. Personaliza las teclas desde Ajustes.",
      ),
      introduced(
        "En móvil, activa el gesto de deslizar hacia la derecha para borrar tareas desde la lista.",
      ),
      improved("Ajustes organiza las opciones en un menú lateral."),
    ],
  },
  {
    version: "0.11.0",
    date: "2026-11-22",
    changes: [
      improved("El campo de búsqueda por título de las tareas es más ancho."),
      improved(
        "En móvil, abre Tareas, Rutinas y Proyectos desde el menú lateral del encabezado.",
      ),
      {
        ...updated(
          "Minimiza Organify a la bandeja del sistema y vuelve a abrirlo desde su icono.",
        ),
        windowsOnly: true,
      },
    ],
  },
  {
    version: "0.10.0",
    date: "2026-11-21",
    changes: [
      introduced("Se ha publicado la primera iteración de las rutinas."),
      updated(
        "Crea rutinas diarias o semanales con checklist, historial y racha.",
      ),
      updated(
        "Marca pasos desde Hoy y sincroniza el progreso entre dispositivos.",
      ),
      improved(
        "El espacio de trabajo agrupa las vistas de Tareas y da acceso directo a Rutinas.",
      ),
    ],
  },
  {
    version: "0.9.0",
    date: "2026-11-20",
    changes: [
      updated("Elige el modo claro u oscuro en Ajustes o desde Comandos."),
      updated("Borra todas las tareas desde Comandos con una confirmación."),
      improved("Las confirmaciones de borrado usan el estilo de Organify."),
      {
        ...updated(
          "Expande o contrae el Tablero y el Calendario en sus ventanas independientes.",
        ),
        windowsOnly: true,
      },
    ],
  },
  {
    version: "0.8.0",
    date: "2026-11-20",
    changes: [
      updated("Cambia entre Día, Semana, Mes y Agenda en el calendario."),
      improved(
        "Restaura el título o limpia los campos opcionales desde Editar tarea.",
      ),
      {
        ...updated(
          "Abre tareas, el Tablero y el Calendario en ventanas independientes.",
        ),
        windowsOnly: true,
      },
      {
        ...updated(
          "Elige en Ajustes si cerrar minimiza Organify para recibir recordatorios o sale por completo.",
        ),
        windowsOnly: true,
      },
      {
        ...improved(
          "La barra superior usa controles de ventana con el aspecto habitual de Windows.",
        ),
        windowsOnly: true,
      },
    ],
  },
  {
    version: "0.7.1",
    date: "2026-11-20",
    label: "0.7.1-Windows",
    windowsOnly: true,
    changes: [
      improved(
        "Los controles de ventana funcionan en la barra superior de Windows.",
      ),
    ],
  },
  {
    version: "0.7.0",
    date: "2026-11-20",
    changes: [
      updated("Mantén la sesión iniciada en este dispositivo desde Cuenta."),
      updated("Recuerda el desbloqueo del cifrado en un perfil de confianza."),
      improved(
        "Consulta el estado de la sincronización en el icono de Cuenta.",
      ),
    ],
  },
  {
    version: "0.6.0",
    date: "2026-11-19",
    changes: [
      updated(
        "Nueva interfaz con navegación lateral, colores violeta y una tarjeta con el progreso de hoy.",
      ),
      improved(
        "El espacio de trabajo reúne Hoy, Todas, Próximas y Sin fecha. El historial agrupa las versiones por mes.",
      ),
      updated(
        "Abre las tareas en una vista previa y accede a la edición desde el detalle o el menú de la lista.",
      ),
      updated(
        "El cliente de Windows muestra las notas de lanzamiento al arrancar tras una actualización automática.",
      ),
      updated(
        "El recordatorio del dispositivo se programa al guardar la tarea.",
      ),
    ],
  },
  {
    version: "0.5.1",
    date: "2026-11-19",
    changes: [
      updated(
        "Configura Supabase desde Cuenta si la instalación no trae un proyecto configurado.",
      ),
      improved(
        "El inicio de sesión usa las cabeceras estándar de Supabase. Los mensajes distinguen errores de red, cuenta y configuración del servidor.",
      ),
    ],
  },
  {
    version: "0.5.0",
    date: "2026-11-16",
    changes: [
      updated(
        "Las tareas vencidas muestran una alarma roja y las hechas, un check verde.",
      ),
      updated(
        "Renombra y cambia el color de un proyecto desde su menú en la barra lateral.",
      ),
      updated("Las tareas heredan el color de su proyecto."),
      improved("Más espacio entre las secciones de la barra lateral."),
    ],
  },
  {
    version: "0.4.1",
    date: "2026-11-16",
    changes: [
      updated(
        "Las compilaciones de Windows con actualizador buscan nuevas versiones al arrancar.",
      ),
      updated("La sincronización comprueba la compatibilidad con el servidor."),
    ],
  },
  {
    version: "0.3.0",
    date: "2026-11-16",
    changes: [
      updated("Nuevo logotipo en la barra lateral e icono de la aplicación."),
      improved(
        "La nota enriquecida muestra los controles de formato como iconos.",
      ),
      updated(
        "Separadores en el historial y una X centrada en los botones de cierre.",
      ),
      improved(
        "La captura rápida identifica con más claridad el texto de ejemplo.",
      ),
    ],
  },
  {
    version: "0.2.0",
    date: "2026-11-15",
    changes: [
      updated("Abre el detalle de las tareas en una ventana centrada."),
      updated("Consulta el correo asociado a la sincronización desde Cuenta."),
      updated("El historial muestra la fecha de cada versión."),
      improved("La barra lateral agrupa las vistas iniciales bajo Tareas."),
    ],
  },
  {
    version: "0.1.0",
    date: "2026-11-15",
    changes: [
      updated(
        "Consulta el historial de actualizaciones desde la versión en la barra lateral.",
      ),
      updated(
        "Conecta o desconecta la sincronización desde el icono de cuenta.",
      ),
      updated("Accede a la sección de ajustes desde la cabecera."),
    ],
  },
] as const;

const releaseDate = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeZone: "UTC",
});

const iconButtonClass = "topbar-button w-9";

export function CloseDialogButton({
  onClick,
  disabled,
}: {
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Cerrar"
      title="Cerrar"
      onClick={onClick}
      disabled={disabled}
      className="flex size-9 shrink-0 items-center justify-center rounded-md text-muted enabled:hover:bg-panel enabled:hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-50"
    >
      <svg
        aria-hidden="true"
        className="size-5"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      >
        <path d="m6 6 12 12M18 6 6 18" />
      </svg>
    </button>
  );
}

const dialogClass =
  "m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-paper text-foreground shadow-xl backdrop:bg-black/35";
const dialogHeaderClass =
  "flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6";

export function DeleteConfirmation({
  title,
  children,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    cancelButton.current?.focus();
    return () => modal?.close();
  }, []);

  async function confirm() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onConfirm();
    } catch {
      setError("No se pudo completar el borrado. Vuelve a intentarlo.");
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      className={`${dialogClass} w-[min(28rem,calc(100%-2rem))]`}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className={dialogHeaderClass}>
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <CloseDialogButton onClick={onCancel} disabled={busy} />
      </div>
      <div className="space-y-3 p-5 text-sm">
        <p id={descriptionId} className="wrap-anywhere">
          {children}
        </p>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line px-4 py-3 sm:px-6">
        <button
          ref={cancelButton}
          type="button"
          className="nav-link"
          disabled={busy}
          onClick={onCancel}
        >
          Cancelar
        </button>
        <Button
          type="button"
          className="gap-1.5 bg-danger-button text-white hover:bg-danger-button/90"
          onClick={() => void confirm()}
          disabled={busy}
        >
          <InterfaceIcon name="trash" />
          {busy ? "Borrando…" : confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}

export function RenameDialog({
  title,
  name,
  close,
  save,
}: {
  title: string;
  name: string;
  close: () => void;
  save: (name: string) => Promise<unknown>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [draft, setDraft] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => modal?.close();
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className={`${dialogClass} w-[min(28rem,calc(100%-2rem))]`}
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) close();
      }}
    >
      <div className={dialogHeaderClass}>
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <CloseDialogButton onClick={close} disabled={saving} />
      </div>
      <form
        className="grid gap-4 p-5"
        onSubmit={async (event) => {
          event.preventDefault();
          const next = draft.trim();
          if (!next || saving) return;
          setError("");
          setSaving(true);
          try {
            if (next !== name) await save(next);
            close();
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "No se pudo guardar el nombre.",
            );
            setSaving(false);
          }
        }}
      >
        <label className="grid gap-1 text-sm">
          Nombre
          <input
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            className="field"
            value={draft}
            required
            disabled={saving}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button
          type="submit"
          className="justify-self-end"
          disabled={!draft.trim() || saving}
        >
          Guardar
        </Button>
      </form>
    </dialog>
  );
}

function AppDialog({
  title,
  label = title,
  tooltip = title,
  trigger,
  triggerClass,
  wide = false,
  children,
}: {
  title: string;
  label?: string;
  tooltip?: string;
  trigger: ReactNode;
  triggerClass: string;
  wide?: boolean;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  return (
    <>
      <button
        type="button"
        className={triggerClass}
        aria-haspopup="dialog"
        aria-label={label}
        title={tooltip}
        onClick={() => dialog.current?.showModal()}
      >
        {trigger}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className={`${dialogClass} ${wide ? "w-[min(60rem,calc(100%-1.5rem))]" : "w-[min(32rem,calc(100%-2rem))]"}`}
      >
        <div className={dialogHeaderClass}>
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <CloseDialogButton onClick={() => dialog.current?.close()} />
        </div>
        <div className={wide ? "" : "p-5"}>{children}</div>
      </dialog>
    </>
  );
}

const releaseMonth = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

function ReleaseChanges({ release }: { release: Release }) {
  const changes = release.changes
    .filter(({ windowsOnly }) => !windowsOnly || desktopWindow)
    .sort(
      (a, b) =>
        releaseChangeStyles[a.kind].order - releaseChangeStyles[b.kind].order,
    );

  return (
    <>
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">
          Versión {release.label ?? release.version}
        </h3>
        <time className="text-xs text-muted" dateTime={release.date}>
          {releaseDate.format(new Date(release.date))}
        </time>
      </header>
      <ul className="grid text-sm">
        {changes.map(({ kind, text }) => {
          const { label, badge, dot } = releaseChangeStyles[kind];
          return (
            <li
              key={text}
              className="group grid grid-cols-[5rem_1.5rem_minmax(0,1fr)] items-start"
            >
              <span
                className={`rounded-full px-1 py-0.5 text-center text-xs font-medium ${badge}`}
              >
                {label}
              </span>
              <span
                aria-hidden="true"
                className="relative w-px justify-self-center self-stretch bg-line"
              >
                <span
                  className={`absolute top-2.5 left-1/2 size-2 -translate-1/2 rounded-full ${dot}`}
                />
              </span>
              <span className="pb-2.5 group-last:pb-0">{text}</span>
            </li>
          );
        })}
      </ul>
    </>
  );
}

const skipUpdateNotesKey = "organify.hide-automatic-release-notes";

export function AutomaticReleaseNotes() {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [skip, setSkip] = useState(false);
  const release = releases.find(
    (entry) => entry.version === desktopVersion.split("-")[0],
  );

  useEffect(() => {
    const core = window.__TAURI__?.core;
    if (!import.meta.env.PROD || !core) return;
    let active = true;
    void core
      .invoke("pending_release_notes", { dismiss: false })
      .then((pending) => {
        if (!active || pending !== true) return;
        if (!release || localStorage.getItem(skipUpdateNotesKey) === "true") {
          return core.invoke("pending_release_notes", { dismiss: true });
        }
        dialog.current?.showModal();
      })
      .catch((error: unknown) =>
        console.error("No se pudieron abrir las notas de lanzamiento.", error),
      );
    return () => {
      active = false;
    };
  }, [release]);

  function acknowledge() {
    if (skip) localStorage.setItem(skipUpdateNotesKey, "true");
    void window.__TAURI__?.core
      .invoke("pending_release_notes", { dismiss: true })
      .catch((error: unknown) =>
        console.error("No se pudieron cerrar las notas de lanzamiento.", error),
      );
  }

  if (!release) return null;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={headingId}
      onClose={acknowledge}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(42rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-line bg-paper text-foreground shadow-xl backdrop:bg-black/35"
    >
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id={headingId} className="text-lg font-semibold">
          Notas de lanzamiento
        </h2>
        <CloseDialogButton onClick={() => dialog.current?.close()} />
      </div>
      <div className="p-5">
        <ReleaseChanges release={release} />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3">
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            className="accent-primary"
            checked={skip}
            onChange={(event) => setSkip(event.target.checked)}
          />
          No mostrar de nuevo
        </label>
        <Button type="button" onClick={() => dialog.current?.close()}>
          Cerrar
        </Button>
      </div>
    </dialog>
  );
}

export function ReleaseNotes() {
  const desktop = Boolean(window.__TAURI__);
  const platform = desktop
    ? "Rust"
    : Capacitor.isNativePlatform()
      ? "Capacitor"
      : "PWA";
  const currentVersion = desktop ? desktopVersion : version;
  const platformReleases = releases.filter(
    (entry) => desktop || !entry.windowsOnly,
  );
  const displayVersion = platformReleases.find(
    (entry) => entry.version === currentVersion,
  )?.label;
  const versionLabel = `Versión ${displayVersion ?? `${platform}++${currentVersion}`}`;
  const releasesByMonth = new Map<string, Release[]>();
  for (const release of platformReleases) {
    const key = release.date.slice(0, 7);
    const entries = releasesByMonth.get(key) ?? [];
    entries.push(release);
    releasesByMonth.set(key, entries);
  }
  const history = useRef<HTMLDivElement>(null);
  const [activeVersion, setActiveVersion] = useState<string>(
    platformReleases[0].version,
  );

  function updateActiveVersion() {
    const list = history.current;
    if (!list?.clientHeight) return;
    const sections = Array.from(
      list.querySelectorAll<HTMLElement>("[data-version]"),
    );
    const nearTop = list.scrollTop + 12;
    const section =
      list.scrollTop > 0 &&
      list.scrollTop + list.clientHeight >= list.scrollHeight - 1
        ? sections.at(-1)
        : sections.reverse().find((entry) => entry.offsetTop <= nearTop);
    if (section?.dataset.version) setActiveVersion(section.dataset.version);
  }

  function scrollToVersion(target: string) {
    const list = history.current;
    const section = list?.querySelector<HTMLElement>(
      `[data-version="${target}"]`,
    );
    if (list && section) list.scrollTop = section.offsetTop;
    setActiveVersion(target);
  }

  return (
    <>
      <AppDialog
        title="Notas de lanzamiento"
        label={`${versionLabel}. Ver notas de lanzamiento`}
        trigger={
          <>
            <span
              aria-hidden="true"
              className="size-2 shrink-0 rounded-full bg-emerald-600"
            />
            {versionLabel}
            <span aria-hidden="true" className="ml-auto">
              ?
            </span>
          </>
        }
        triggerClass="nav-link flex w-full items-center gap-2 text-xs"
        wide
      >
        <div className="grid h-[min(36rem,calc(100dvh-6rem))] min-h-0 grid-cols-[minmax(5rem,26%)_minmax(0,1fr)]">
          <nav
            aria-label="Versiones por mes"
            className="release-version-nav overflow-y-auto overscroll-contain border-r border-line bg-panel px-2 py-3 sm:p-4"
          >
            {[...releasesByMonth].map(([key, entries]) => (
              <section key={key} className="mb-4 grid gap-1">
                <h3 className="px-1 py-1 text-xs font-semibold text-muted">
                  {releaseMonth.format(new Date(entries[0].date))}
                </h3>
                {entries.map((entry) => (
                  <button
                    key={entry.version}
                    type="button"
                    className="nav-link w-full px-2 text-xs"
                    aria-current={
                      activeVersion === entry.version ? "true" : undefined
                    }
                    onClick={() => scrollToVersion(entry.version)}
                  >
                    {entry.label ?? entry.version}
                  </button>
                ))}
              </section>
            ))}
          </nav>
          <div
            ref={history}
            onScroll={updateActiveVersion}
            tabIndex={0}
            role="region"
            aria-label="Historial de cambios"
            className="relative overflow-y-auto overscroll-contain focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-primary"
          >
            {platformReleases.map((release) => (
              <article
                key={release.version}
                data-version={release.version}
                className="border-b border-line p-4 last:min-h-full last:border-b-0 sm:p-6"
              >
                <ReleaseChanges release={release} />
              </article>
            ))}
          </div>
        </div>
      </AppDialog>
    </>
  );
}

const syncStatusLabel: Record<SyncStatus, string> = {
  inactive: "Sincronización inactiva",
  pending: "Conectando con la sincronización",
  synced: "Sincronización al día",
  error: "Problema de sincronización",
};

function SyncBadge({ status }: { status: SyncStatus }) {
  return (
    <svg
      aria-hidden="true"
      className={`absolute -bottom-1 -right-1 size-3.5 rounded-full ring-1 ring-paper ${
        status === "synced"
          ? "bg-emerald-700 text-white"
          : status === "error"
            ? "bg-red-700 text-white"
            : "bg-paper text-muted"
      }`}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {status === "synced" ? (
        <path d="m4 8 2.5 2.5L12 5" />
      ) : status === "error" ? (
        <path d="M8 4.5v4m0 2.8h.01" />
      ) : (
        <path d="m3 3 10 10M7 4.5a9 9 0 0 1 7 2m-12 0 2-1.2M4 9a6 6 0 0 1 2.3-1.2m3.7 0L12 9m-6 2.4a3 3 0 0 1 3.5-.4M8 13h.01" />
      )}
    </svg>
  );
}

export function AppControls({
  store,
  darkMode,
  onThemeChange,
  preferences,
  viewPreferences,
}: {
  store: TaskRepositories["sync"];
  darkMode: boolean;
  onThemeChange: (dark: boolean) => void;
  preferences: WorkspacePreferences;
  viewPreferences: ViewPreferences;
}) {
  const [status, setStatus] = useState<SyncStatus>("inactive");
  const [settings, setSettings] = useState<
    "general" | "shortcuts" | "advanced"
  >("general");
  const sections = [
    { id: "general", label: "General", visible: true },
    {
      id: "shortcuts",
      label: "Atajos de teclado",
      visible: preferences.keyboardShortcuts,
    },
    { id: "advanced", label: "Avanzado", visible: true },
  ] as const;
  const accountLabel = `Cuenta. ${syncStatusLabel[status]}`;
  return (
    <>
      <AppDialog
        title="Ajustes"
        wide
        triggerClass={iconButtonClass}
        trigger={
          <svg
            aria-hidden="true"
            className="size-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="m9 3-.5 2.1-1.8 1-2.1-.6-2 3.5 1.6 1.5v2l-1.6 1.5 2 3.5 2.1-.6 1.8 1 .5 2.1h4l.5-2.1 1.8-1 2.1.6 2-3.5-1.6-1.5v-2l1.6-1.5-2-3.5-2.1.6-1.8-1L13 3z"
              transform="translate(1 0.5)"
            />
            <circle cx="12" cy="12" r="3" />
          </svg>
        }
      >
        <div className="grid h-[min(27rem,calc(100dvh-6rem))] min-h-0 grid-cols-[minmax(5rem,26%)_minmax(0,1fr)]">
          <nav
            aria-label="Secciones de ajustes"
            className="space-y-1 overflow-y-auto border-r border-line bg-panel px-2 py-3 sm:p-4"
          >
            {sections
              .filter(({ visible }) => visible)
              .map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  className="nav-link w-full text-xs sm:text-sm"
                  aria-current={settings === id || undefined}
                  onClick={() => setSettings(id)}
                >
                  {label}
                </button>
              ))}
          </nav>
          <div className="overflow-y-auto overscroll-contain p-4 sm:p-6">
            <h3 className="mb-4 text-lg font-semibold">
              {sections.find(({ id }) => id === settings)?.label}
            </h3>
            {settings === "shortcuts" && <ShortcutSettings {...preferences} />}
            {settings === "advanced" &&
              (desktopWindow ? (
                <ExperimentalUpdates />
              ) : (
                <p className="text-sm text-muted">
                  Las actualizaciones experimentales están disponibles en
                  Windows.
                </p>
              ))}
            {settings === "general" && (
              <div className="grid gap-4">
                <label className="grid gap-1 text-sm">
                  Tema
                  <select
                    className="field"
                    value={darkMode ? "dark" : "light"}
                    onChange={(event) =>
                      onThemeChange(event.target.value === "dark")
                    }
                  >
                    <option value="light">Modo claro</option>
                    <option value="dark">Modo oscuro</option>
                  </select>
                </label>
                <label className="grid gap-1 text-sm">
                  Vista predeterminada
                  <select
                    className="field"
                    value={viewPreferences.startupView}
                    onChange={(event) => {
                      const view = startupViews.find(
                        ({ id }) => id === event.target.value,
                      );
                      if (view) viewPreferences.save({ startupView: view.id });
                    }}
                  >
                    {startupViews.map(({ id, label }) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-0.5 accent-primary"
                    checked={viewPreferences.hideTaskStatus}
                    onChange={(event) =>
                      viewPreferences.save({
                        hideTaskStatus: event.target.checked,
                      })
                    }
                  />
                  Ocultar los iconos de estado de las tareas
                </label>
                {supportsFontSize && (
                  <label className="grid gap-1 text-sm">
                    Tamaño de letra
                    <select
                      className="field"
                      value={viewPreferences.fontSize}
                      onChange={(event) => {
                        const size = fontSizes.find(
                          (value) => value === Number(event.target.value),
                        );
                        if (size) viewPreferences.save({ fontSize: size });
                      }}
                    >
                      {fontSizes.map((size) => (
                        <option key={size} value={size}>
                          {size} %
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {desktopWindow && (
                  <>
                    <DesktopPreference command="maximize_on_startup">
                      Iniciar con la ventana maximizada
                    </DesktopPreference>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 accent-primary"
                        checked={viewPreferences.tasksInWindows}
                        onChange={(event) =>
                          viewPreferences.save({
                            tasksInWindows: event.target.checked,
                          })
                        }
                      />
                      Abrir las tareas en ventanas independientes
                    </label>
                    <DesktopPreference command="minimize_on_close">
                      Ocultar en la bandeja al cerrar y seguir recibiendo
                      recordatorios
                    </DesktopPreference>
                  </>
                )}
                {preferences.mobile && (
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-0.5 accent-primary"
                      checked={preferences.swipeToDelete}
                      onChange={(event) =>
                        preferences.changeSwipe(event.target.checked)
                      }
                    />
                    Deslizar hacia la derecha para borrar tareas en la lista
                  </label>
                )}
                <PwaSettings />
              </div>
            )}
          </div>
        </div>
      </AppDialog>
      <AppDialog
        title="Cuenta"
        label={accountLabel}
        tooltip={accountLabel}
        triggerClass={`${iconButtonClass} topbar-account`}
        trigger={
          <span className="relative inline-flex">
            <svg
              aria-hidden="true"
              className="size-5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
            >
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
            </svg>
            <SyncBadge status={status} />
          </span>
        }
      >
        <SyncSettings store={store} status={status} onStatus={setStatus} />
      </AppDialog>
    </>
  );
}
