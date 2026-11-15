import { useId, useRef, type ReactNode } from "react";
import type { TaskRepositories } from "@organify/storage";
import { version } from "../package.json";
import { SyncSettings } from "./sync-settings";

const releases = [
  {
    version: "0.3.0",
    date: "2026-11-16",
    changes: [
      "Nuevo logotipo en la barra lateral e icono de la aplicación.",
      "La nota enriquecida muestra los controles de formato como iconos.",
      "Separadores en el historial y una X centrada en los botones de cierre.",
      "La captura rápida identifica con más claridad el texto de ejemplo.",
    ],
  },
  {
    version: "0.2.0",
    date: "2026-11-15",
    changes: [
      "Abre el detalle de las tareas en una ventana centrada.",
      "Consulta el correo asociado a la sincronización desde Cuenta.",
      "El historial muestra la fecha de cada versión.",
      "La barra lateral agrupa las vistas iniciales bajo Tareas.",
    ],
  },
  {
    version: "0.1.0",
    date: "2026-11-15",
    changes: [
      "Consulta el historial de actualizaciones desde la versión en la barra lateral.",
      "Conecta o desconecta la sincronización desde el icono de cuenta.",
      "Accede a la sección de ajustes desde la cabecera.",
    ],
  },
];

const releaseDate = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
  timeZone: "UTC",
});

const iconButtonClass =
  "inline-flex size-10 items-center justify-center rounded-lg border border-line bg-paper hover:bg-panel focus-visible:outline-2 focus-visible:outline-offset-2";

export function CloseDialogButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Cerrar"
      title="Cerrar"
      onClick={onClick}
      className="flex size-9 shrink-0 items-center justify-center rounded-md border border-danger/25 bg-danger/10 text-danger hover:bg-danger hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
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
  trigger,
  triggerClass,
  children,
}: {
  title: string;
  label?: string;
  trigger: ReactNode;
  triggerClass: string;
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
        title={title}
        onClick={() => dialog.current?.showModal()}
      >
        {trigger}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-line bg-paper p-5 text-foreground shadow-xl backdrop:bg-black/35"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold">
            {title}
          </h2>
          <CloseDialogButton onClick={() => dialog.current?.close()} />
        </div>
        {children}
      </dialog>
    </>
  );
}

export function ReleaseNotes() {
  return (
    <AppDialog
      title="Ver notas de actualizaciones"
      label={`Versión ${version}. Ver notas de actualizaciones`}
      trigger={`Versión ${version}`}
      triggerClass="nav-link mx-auto block font-semibold text-danger"
    >
      <div className="divide-y divide-line">
        {releases.map((release) => (
          <section key={release.version} className="py-4 first:pt-0 last:pb-0">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h3 className="font-semibold">Versión {release.version}</h3>
              <time dateTime={release.date} className="text-sm text-muted">
                {releaseDate.format(new Date(release.date))}
              </time>
            </div>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
              {release.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </AppDialog>
  );
}

export function AppControls({ store }: { store: TaskRepositories["sync"] }) {
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
          >
            <circle cx="12" cy="8" r="3.5" />
            <path d="M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
          </svg>
        }
      >
        <SyncSettings store={store} />
      </AppDialog>
    </>
  );
}
