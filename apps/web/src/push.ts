import { Capacitor } from "@capacitor/core";
import {
  pushReminderList,
  remindersChangedEvent,
  remindersStorageKey,
} from "./reminders";
import {
  detectPushAvailability,
  isIosDevice,
  isStandalone,
  type PushAvailability,
} from "./push-support";
import type { createAccountClient } from "./sync-connection";

export type { PushAvailability };

type AccountApi = ReturnType<typeof createAccountClient>["api"];

export interface PushAccount {
  api: AccountApi;
  projectUrl: string;
  userId: string;
}

function currentAvailability() {
  return detectPushAvailability({
    native: Boolean(window.__TAURI__) || Capacitor.isNativePlatform(),
    ios: isIosDevice(navigator.userAgent, navigator.maxTouchPoints),
    standalone: isStandalone(),
    push:
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window,
  });
}

interface SavedPush {
  projectUrl: string;
  userId: string;
  endpoint: string;
  subscriptionId: string;
}

const savedKey = "organify.push.v1";

function readSaved(): SavedPush | undefined {
  try {
    return JSON.parse(localStorage.getItem(savedKey) ?? "null") ?? undefined;
  } catch {
    return undefined;
  }
}

function writeSaved(value?: SavedPush) {
  if (value) localStorage.setItem(savedKey, JSON.stringify(value));
  else localStorage.removeItem(savedKey);
}

export interface PushState {
  availability: PushAvailability;
  signedIn: boolean;
  enabled: boolean;
  busy: boolean;
  error: string;
}

let account: PushAccount | undefined;
let state: PushState = {
  availability: currentAvailability(),
  signedIn: false,
  enabled: false,
  busy: false,
  error: "",
};
const listeners = new Set<() => void>();

function update(changes: Partial<PushState>) {
  state = { ...state, ...changes };
  for (const listener of listeners) listener();
}

export function subscribePush(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getPushState() {
  return state;
}

function savedForAccount() {
  const saved = readSaved();
  return account &&
    saved?.projectUrl === account.projectUrl &&
    saved.userId === account.userId
    ? saved
    : undefined;
}

const vapidKeys = new Map<string, Promise<Uint8Array<ArrayBuffer>>>();

function decodeKey(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeKey(buffer: ArrayBuffer | null) {
  if (!buffer) throw new Error("La suscripción push no tiene claves.");
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

const serverMissing =
  "El proyecto de Supabase no tiene configurados los avisos push. Consulta DEVNOTES.md.";

function vapidKey(projectUrl: string) {
  let key = vapidKeys.get(projectUrl);
  if (!key) {
    key = fetch(projectUrl + "/functions/v1/organify-push")
      .then(async (response) => {
        if (!response.ok) throw new Error(serverMissing);
        const { publicKey } = (await response.json()) as { publicKey?: string };
        if (!publicKey) throw new Error(serverMissing);
        return decodeKey(publicKey);
      })
      .catch((error: unknown) => {
        vapidKeys.delete(projectUrl);
        throw error instanceof Error && error.message === serverMissing
          ? error
          : new Error(
              "No se pudo contactar con el servidor de avisos push. Comprueba la conexión.",
            );
      });
    vapidKeys.set(projectUrl, key);
  }
  return key;
}

async function workerRegistration() {
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration)
    throw new Error(
      "Los avisos push necesitan la versión instalada de la web (no el modo de desarrollo).",
    );
  return navigator.serviceWorker.ready;
}

function sameKey(buffer: ArrayBuffer | null | undefined, key: Uint8Array) {
  // Si el navegador no expone la clave, se asume la actual para no
  // suscribirse de nuevo en cada sincronización.
  if (!buffer) return true;
  if (buffer.byteLength !== key.length) return false;
  return new Uint8Array(buffer).every((byte, index) => byte === key[index]);
}

async function browserSubscription(projectUrl: string, create: boolean) {
  const registration = await workerRegistration();
  const key = await vapidKey(projectUrl);
  let subscription = await registration.pushManager.getSubscription();
  if (
    subscription &&
    !sameKey(subscription.options.applicationServerKey, key)
  ) {
    // Cambió la clave VAPID del servidor: hay que suscribirse de nuevo.
    await subscription.unsubscribe();
    subscription = null;
  }
  if (!subscription && (create || Notification.permission === "granted")) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: key,
    });
  }
  return subscription;
}

async function register(target: PushAccount, subscription: PushSubscription) {
  const { data, error } = await target.api.rpc("organify_push_register", {
    endpoint: subscription.endpoint,
    p256dh: encodeKey(subscription.getKey("p256dh")),
    auth_secret: encodeKey(subscription.getKey("auth")),
  });
  if (error) throw error;
  const saved: SavedPush = {
    projectUrl: target.projectUrl,
    userId: target.userId,
    endpoint: subscription.endpoint,
    subscriptionId: data as string,
  };
  writeSaved(saved);
  return saved;
}

function isMissingSubscription(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "P0002"
  );
}

async function uploadReminders(
  target: PushAccount,
  saved: SavedPush,
  subscription: PushSubscription,
) {
  const reminders = await pushReminderList();
  const replace = (subscriptionId: string) =>
    target.api.rpc("organify_push_replace", {
      subscription: subscriptionId,
      reminders,
    });
  let { error } = await replace(saved.subscriptionId);
  if (isMissingSubscription(error)) {
    // El servidor retiró la suscripción (p. ej. caducó): se registra otra vez.
    ({ error } = await replace(
      (await register(target, subscription)).subscriptionId,
    ));
  }
  if (error) throw error;
}

function pushMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (code === "PGRST202" || code === "42883")
      return "Falta la migración de avisos push en Supabase. Consulta DEVNOTES.md.";
  }
  return "No se pudieron actualizar los avisos push.";
}

// Las operaciones se encadenan para no registrar dos veces a la vez.
let queue: Promise<void> = Promise.resolve();
let refreshQueued = false;

function enqueue(run: () => Promise<void>) {
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}

async function refreshNow() {
  const target = account;
  const saved = savedForAccount();
  if (!target || !saved || state.availability !== "available") return;
  try {
    const subscription = await browserSubscription(target.projectUrl, false);
    if (!subscription) {
      // El permiso se retiró desde los ajustes del sistema.
      writeSaved();
      update({
        enabled: false,
        error:
          "Los avisos push se desactivaron porque el permiso de notificaciones ya no está concedido.",
      });
      return;
    }
    const current =
      subscription.endpoint === saved.endpoint
        ? saved
        : await register(target, subscription);
    await uploadReminders(target, current, subscription);
    update({ enabled: true, error: "" });
  } catch (error) {
    update({ error: pushMessage(error) });
  }
}

/** Vuelve a enviar la lista de recordatorios si los avisos push están activos. */
export function refreshPush() {
  if (refreshQueued) return queue;
  refreshQueued = true;
  return enqueue(async () => {
    refreshQueued = false;
    await refreshNow();
  });
}

export function setPushAccount(next?: PushAccount) {
  account = next;
  const saved = savedForAccount();
  update({ signedIn: Boolean(next), enabled: Boolean(saved), error: "" });
  if (!next || state.availability !== "available") return;
  // Se pide la clave antes para no perder el gesto del usuario al activar.
  void vapidKey(next.projectUrl).catch(() => undefined);
  if (saved) void refreshPush();
}

/** Llamar directamente desde el gesto del usuario (requisito de iOS). */
export function enablePush() {
  // El permiso se pide antes de cualquier espera para conservar el gesto.
  const permission = Notification.requestPermission();
  update({ busy: true, error: "" });
  return enqueue(async () => {
    try {
      const target = account;
      if (!target)
        throw new Error(
          "Inicia sesión en Cuenta para activar los avisos push.",
        );
      if ((await permission) !== "granted")
        throw new Error(
          "Permite las notificaciones de Organify en los ajustes del navegador o del sistema.",
        );
      const subscription = await browserSubscription(target.projectUrl, true);
      if (!subscription)
        throw new Error("No se pudo crear la suscripción push.");
      const saved = await register(target, subscription);
      await uploadReminders(target, saved, subscription);
      update({ enabled: true });
    } catch (error) {
      update({ error: pushMessage(error) });
    } finally {
      update({ busy: false });
    }
  });
}

async function unregister(target: PushAccount | undefined) {
  const saved = savedForAccount();
  writeSaved();
  let failed = false;
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (target && (saved || subscription)) {
      const { error } = await target.api.rpc("organify_push_unregister", {
        endpoint: saved?.endpoint ?? subscription?.endpoint,
      });
      if (error) failed = true;
    }
    await subscription?.unsubscribe();
  } catch {
    failed = true;
  }
  return failed;
}

export function disablePush() {
  update({ busy: true, error: "" });
  return enqueue(async () => {
    const failed = await unregister(account);
    update({
      busy: false,
      enabled: false,
      error: failed
        ? "Los avisos push se desactivaron en este dispositivo, pero el servidor no confirmó la baja."
        : "",
    });
  });
}

/** Retira la suscripción antes de cerrar sesión. Nunca lanza errores. */
export function releasePush() {
  if (!savedForAccount()) return Promise.resolve();
  return enqueue(async () => {
    await unregister(account);
    update({ enabled: false });
  });
}

if (typeof window !== "undefined") {
  window.addEventListener(remindersChangedEvent, () => void refreshPush());
  window.addEventListener("storage", (event) => {
    if (event.key === remindersStorageKey) void refreshPush();
  });
  window.addEventListener("online", () => {
    if (state.error) void refreshPush();
  });
}
