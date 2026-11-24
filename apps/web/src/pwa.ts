import { Capacitor } from "@capacitor/core";
import { useSyncExternalStore } from "react";
import { isIosDevice, isStandalone } from "./push-support";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export interface PwaState {
  /** Navegador web (no Tauri ni Capacitor). */
  web: boolean;
  installed: boolean;
  ios: boolean;
  canInstall: boolean;
  updateReady: boolean;
}

const web = !window.__TAURI__ && !Capacitor.isNativePlatform();
let installPrompt: InstallPromptEvent | undefined;
let waiting: ServiceWorker | undefined;
let state: PwaState = {
  web,
  installed: isStandalone(),
  ios: isIosDevice(navigator.userAgent, navigator.maxTouchPoints),
  canInstall: false,
  updateReady: false,
};
const listeners = new Set<() => void>();

function update(changes: Partial<PwaState>) {
  state = { ...state, ...changes };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePwaState() {
  return useSyncExternalStore(subscribe, () => state);
}

if (web) {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Se muestra un botón propio en Ajustes en lugar del aviso del navegador.
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    update({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = undefined;
    update({ canInstall: false, installed: true });
  });
  window
    .matchMedia("(display-mode: standalone)")
    .addEventListener("change", () => update({ installed: isStandalone() }));
}

export async function promptInstall() {
  const prompt = installPrompt;
  if (!prompt) return;
  installPrompt = undefined;
  update({ canInstall: false });
  await prompt.prompt();
  await prompt.userChoice;
}

export function applyUpdate() {
  if (!waiting) return;
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
  waiting.postMessage({ type: "organify:skip-waiting" });
}

function trackWaiting(registration: ServiceWorkerRegistration) {
  // Sin controlador es la primera instalación: no hay nada que actualizar.
  if (registration.waiting && navigator.serviceWorker.controller) {
    waiting = registration.waiting;
    update({ updateReady: true });
  }
}

export function registerServiceWorker() {
  if (!import.meta.env.PROD || !web || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker
    .register(import.meta.env.BASE_URL + "sw.js")
    .then((registration) => {
      trackWaiting(registration);
      registration.addEventListener("updatefound", () => {
        const worker = registration.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed") trackWaiting(registration);
        });
      });
      // Una PWA instalada puede seguir abierta días: busca versiones nuevas
      // al volver a primer plano.
      let checked = Date.now();
      document.addEventListener("visibilitychange", () => {
        if (
          document.visibilityState !== "visible" ||
          Date.now() - checked < 15 * 60 * 1000
        )
          return;
        checked = Date.now();
        void registration.update().catch(() => undefined);
      });
    })
    .catch((error: unknown) =>
      console.error("No se pudo activar el modo sin conexión.", error),
    );

  // Las apps instaladas pueden pedir almacenamiento persistente sin avisar.
  if (state.installed) void navigator.storage?.persist?.().catch(() => false);
}
