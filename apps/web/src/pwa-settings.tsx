import { useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { InterfaceIcon } from "./interface-icon";
import { disablePush, enablePush, getPushState, subscribePush } from "./push";
import { applyUpdate, promptInstall, usePwaState } from "./pwa";

export function usePushState() {
  return useSyncExternalStore(subscribePush, getPushState);
}

function InstallSettings() {
  const { installed, ios, canInstall } = usePwaState();
  if (installed) return null;
  if (canInstall) {
    return (
      <div className="grid gap-2 text-sm">
        <p className="text-muted">
          Instala Organify para abrirla como una app, sin conexión y con avisos
          en segundo plano.
        </p>
        <Button
          type="button"
          className="justify-self-start"
          onClick={() => void promptInstall()}
        >
          Instalar Organify
        </Button>
      </div>
    );
  }
  if (ios) {
    return (
      <p className="text-sm text-muted">
        Para instalar Organify en iPhone o iPad, toca <strong>Compartir</strong>{" "}
        y después <strong>Añadir a pantalla de inicio</strong>. Ábrela desde el
        icono para recibir avisos con la app cerrada.
      </p>
    );
  }
  return null;
}

function PushSettings() {
  const { availability, signedIn, enabled, busy, error } = usePushState();
  if (availability === "native") return null;

  let help: string;
  if (availability === "install-required")
    help =
      "En iPhone y iPad los avisos con la app cerrada solo funcionan desde la app añadida a la pantalla de inicio.";
  else if (availability === "unsupported")
    help = "Este navegador no admite avisos push.";
  else if (!signedIn)
    help =
      "Inicia sesión en Cuenta para recibir los recordatorios aunque Organify esté cerrada.";
  else
    help =
      "El servidor solo conoce la hora de cada recordatorio. El aviso muestra un texto genérico.";

  const canToggle = availability === "available" && signedIn && !busy;
  return (
    <div className="grid gap-1 text-sm">
      <label className="flex items-start gap-2">
        <input
          type="checkbox"
          className="mt-0.5 accent-primary"
          checked={enabled}
          disabled={!canToggle}
          onChange={(event) => {
            // enablePush pide el permiso dentro de este gesto (iOS lo exige).
            if (event.target.checked) void enablePush();
            else void disablePush();
          }}
        />
        Recibir recordatorios con la app cerrada
      </label>
      <p className="text-muted">{busy ? "Configurando avisos push…" : help}</p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function PwaSettings() {
  const { web } = usePwaState();
  if (!web) return null;
  return (
    <section className="grid gap-3 border-t border-line pt-4">
      <h4 className="text-sm font-semibold">App y avisos</h4>
      <InstallSettings />
      <PushSettings />
    </section>
  );
}

export function UpdateBanner() {
  const { updateReady } = usePwaState();
  if (!updateReady) return null;
  return (
    <div
      role="status"
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-4 z-40 flex max-w-[calc(100%-2rem)] items-center gap-3 rounded-xl border border-line bg-paper p-3 text-sm shadow-lg"
    >
      <InterfaceIcon name="reset" className="size-4 shrink-0 text-primary" />
      <span>Hay una versión nueva de Organify.</span>
      <Button type="button" className="h-8 px-3" onClick={applyUpdate}>
        Actualizar
      </Button>
    </div>
  );
}
