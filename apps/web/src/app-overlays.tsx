import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import type { TaskRepositories } from "@organify/storage";
import { Button } from "@/components/ui/button";
import { version } from "../package.json";
import { SyncSettings, type SyncStatus } from "./sync-settings";

const updated = (text: string) => ({ text, label: "Actualizado" as const });
const improved = (text: string) => ({ text, label: "Mejorado" as const });

const releases = [
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
        className={`m-auto max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-paper text-foreground shadow-xl backdrop:bg-black/35 ${wide ? "w-[min(60rem,calc(100%-1.5rem))]" : "w-[min(32rem,calc(100%-2rem))]"}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-6">
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

type Release = (typeof releases)[number];
const releaseMonth = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});
const releasesByMonth = new Map<string, Release[]>();
for (const release of releases) {
  const key = release.date.slice(0, 7);
  const entries = releasesByMonth.get(key) ?? [];
  entries.push(release);
  releasesByMonth.set(key, entries);
}

function ReleaseChanges({ release }: { release: Release }) {
  const changes = [
    ...release.changes.filter(({ label }) => label === "Actualizado"),
    ...release.changes.filter(({ label }) => label === "Mejorado"),
  ];

  return (
    <>
      <header className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-semibold">Versión {release.version}</h3>
        <time className="text-xs text-muted" dateTime={release.date}>
          {releaseDate.format(new Date(release.date))}
        </time>
      </header>
      <ul className="grid text-sm">
        {changes.map(({ label, text }) => (
          <li
            key={text}
            className="group grid grid-cols-[5rem_1.5rem_minmax(0,1fr)] items-start"
          >
            <span
              className={`rounded-full px-1 py-0.5 text-center text-xs font-medium ${label === "Actualizado" ? "bg-tint text-accent-ink" : "bg-emerald-50 text-emerald-800"}`}
            >
              {label}
            </span>
            <span
              aria-hidden="true"
              className="relative w-px justify-self-center self-stretch bg-line"
            >
              <span
                className={`absolute top-2.5 left-1/2 size-2 -translate-1/2 rounded-full ${label === "Actualizado" ? "bg-accent-ink" : "bg-emerald-800"}`}
              />
            </span>
            <span className="pb-2.5 group-last:pb-0">{text}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

const skipUpdateNotesKey = "organify.hide-automatic-release-notes";

function AutomaticReleaseNotes() {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const [skip, setSkip] = useState(false);
  const release = releases.find((entry) => entry.version === version);

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
  const platform = window.__TAURI__
    ? "Rust"
    : Capacitor.isNativePlatform()
      ? "Capacitor"
      : "PWA";
  const versionLabel = `Versión ${platform}++${version}`;
  const history = useRef<HTMLDivElement>(null);
  const [activeVersion, setActiveVersion] = useState<string>(
    releases[0].version,
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
      <AutomaticReleaseNotes />
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
            className="overflow-y-auto overscroll-contain border-r border-line bg-panel px-2 py-3 sm:p-4"
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
                    {entry.version}
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
            {releases.map((release) => (
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

export function AppControls({ store }: { store: TaskRepositories["sync"] }) {
  const [status, setStatus] = useState<SyncStatus>("inactive");
  const accountLabel = `Cuenta. ${syncStatusLabel[status]}`;
  return (
    <>
      <AppDialog
        title="Ajustes"
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
        <p className="text-sm text-muted">Sección en desarrollo.</p>
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
