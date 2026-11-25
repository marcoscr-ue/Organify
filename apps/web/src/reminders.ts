import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import type { CalendarEvent } from "@organify/core";
import {
  eventReminderGrace,
  plannedEventReminders,
} from "./event-reminder-plan";

export const isAndroid = Capacitor.getPlatform() === "android";
export const remindersStorageKey = "organify.local-reminders.v1";
export const eventRemindersStorageKey = "organify.event-reminders.v1";
export const remindersChangedEvent = "organify:reminders-changed";
export const reminderPermissionEvent = "organify:reminder-permission";
const title = "Organify";
const taskBody = "Tienes una tarea pendiente.";
const genericBody = "Tienes un recordatorio de Organify.";
const pushLimit = 500;
// Native event IDs live apart from the IDs used by older versions for tasks.
const firstEventNativeId = 100_000;
let eventRemindersReady = false;
// Los avisos ya entregados se conservan una semana para abrir la tarea desde
// la notificación.
const keepDelivered = 7 * 24 * 60 * 60 * 1000;

interface Reminder {
  at: number;
  nativeId?: number;
  nativePending?: true;
  /** Identificador aleatorio del aviso. También identifica el push. */
  key?: string;
  delivered?: boolean;
}

export interface PushReminder {
  id: string;
  at: string;
}

export function isEventReminderId(id: string) {
  return id.startsWith("event/");
}

function readReminders(key = remindersStorageKey): Record<string, Reminder> {
  return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<
    string,
    Reminder
  >;
}

function saveReminders(
  reminders: Record<string, Reminder>,
  key = remindersStorageKey,
) {
  const oldest = Date.now() - keepDelivered;
  for (const [taskId, reminder] of Object.entries(reminders)) {
    if (reminder.at < oldest) delete reminders[taskId];
  }
  const next = JSON.stringify(reminders);
  if (next !== (localStorage.getItem(key) ?? "{}"))
    localStorage.setItem(key, next);
}

function announceChange() {
  window.dispatchEvent(new Event(remindersChangedEvent));
}

function writeReminder(taskId: string, value?: Reminder) {
  const reminders = readReminders();
  if (value) reminders[taskId] = value;
  else delete reminders[taskId];
  saveReminders(reminders);
}

let reminderQueue: Promise<unknown> = Promise.resolve();

async function withReminderLock<T>(run: () => T | Promise<T>): Promise<T> {
  if (navigator.locks)
    return navigator.locks.request("organify-reminders", run) as Promise<T>;
  const next = reminderQueue.then(run);
  reminderQueue = next.catch(() => undefined);
  return next;
}

export function reminderTime(taskId: string) {
  const reminder = readReminders()[taskId];
  return reminder && !reminder.delivered && reminder.at > Date.now()
    ? reminder.at
    : undefined;
}

/** Identificador local asociado a un aviso, incluso si ya se entregó. */
export function taskForReminder(key: string) {
  return Object.entries({
    ...readReminders(),
    ...readReminders(eventRemindersStorageKey),
  }).find(([, reminder]) => reminder.key === key)?.[0];
}

/** Avisos futuros que deben programarse en el servidor push. */
export async function pushReminderList(): Promise<PushReminder[]> {
  return withReminderLock(() => {
    const now = Date.now();
    const list: PushReminder[] = [];
    for (const storageKey of [remindersStorageKey, eventRemindersStorageKey]) {
      const reminders = readReminders(storageKey);
      let changed = false;
      const future = Object.values(reminders)
        .filter(({ at, delivered }) => !delivered && at > now)
        .sort((a, b) => a.at - b.at);
      for (const reminder of future.slice(0, pushLimit - list.length)) {
        if (!reminder.key) {
          reminder.key = crypto.randomUUID();
          changed = true;
        }
        list.push({
          id: reminder.key,
          at: new Date(reminder.at).toISOString(),
        });
      }
      if (changed) saveReminders(reminders, storageKey);
    }
    return list;
  });
}

export async function reminderPermission() {
  if (isAndroid) return (await LocalNotifications.checkPermissions()).display;
  if (window.__TAURI__) return "granted";
  return "Notification" in window ? Notification.permission : "unsupported";
}

async function requestNotificationPermission() {
  if (isAndroid) {
    let { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted")
      ({ display } = await LocalNotifications.requestPermissions());
    if (display !== "granted")
      throw new Error("Permite las notificaciones en Android.");
  } else if (!window.__TAURI__) {
    if (!("Notification" in window))
      throw new Error("Este navegador no admite avisos locales.");
    if ((await Notification.requestPermission()) !== "granted")
      throw new Error("Permite las notificaciones en el navegador.");
  }
}

export async function requestReminderPermission() {
  await requestNotificationPermission();
  window.dispatchEvent(new Event(reminderPermissionEvent));
}

export async function scheduleReminder(taskId: string, at: number) {
  if (!Number.isFinite(at) || at <= Date.now()) {
    throw new Error("Elige una fecha y hora futuras.");
  }
  const key = crypto.randomUUID();
  await requestNotificationPermission();

  if (isAndroid) {
    await withReminderLock(async () => {
      const reminders = readReminders();
      const existing = reminders[taskId]?.nativeId;
      const used = new Set(
        Object.values(reminders).map((entry) => entry.nativeId),
      );
      let id = existing ?? 1;
      if (!existing) {
        while (used.has(id)) id++;
      }
      await LocalNotifications.schedule({
        notifications: [
          {
            id,
            title,
            body: taskBody,
            schedule: { at: new Date(at) },
            isExactNotification: false,
          },
        ],
      });
      writeReminder(taskId, { at, nativeId: id, key });
    });
    return;
  }

  await withReminderLock(() => writeReminder(taskId, { at, key }));
  announceChange();
}

export async function reconcileEventReminders(
  events: readonly CalendarEvent[],
  displayZone: string,
) {
  let changed = false;
  try {
    await withReminderLock(async () => {
      const current = readReminders(eventRemindersStorageKey);
      const now = Date.now();
      const authorized = (await reminderPermission()) === "granted";
      const plan = authorized
        ? plannedEventReminders(events, now, displayZone)
        : [];
      const next: Record<string, Reminder> = {};
      // Keep delivered keys briefly so notification clicks still open the event.
      const scheduled = plan.filter(
        ({ id, at }) => at > now || current[id]?.at === at,
      );
      const desired = new Map(
        (isAndroid ? scheduled.slice(0, 200) : scheduled).map(({ id, at }) => [
          id,
          at,
        ]),
      );
      for (const [id, reminder] of Object.entries(current)) {
        if (
          desired.get(id) === reminder.at ||
          (reminder.delivered && !desired.has(id))
        )
          next[id] = reminder;
      }
      if (isAndroid) {
        const cancelled = Object.entries(current).flatMap(([id, reminder]) =>
          !next[id] && reminder.nativeId !== undefined
            ? [{ id: reminder.nativeId }]
            : [],
        );
        if (cancelled.length) {
          await LocalNotifications.cancel({ notifications: cancelled });
          saveReminders(next, eventRemindersStorageKey);
        }
      }
      const pending: { id: string; reminder: Reminder }[] = [];
      const used = new Set(
        Object.values(next).map((reminder) => reminder.nativeId),
      );
      let nativeId = firstEventNativeId;
      for (const [id, at] of desired) {
        if (at <= now) continue;
        const existing = next[id];
        if (existing?.at === at) {
          if (existing.nativePending) pending.push({ id, reminder: existing });
          continue;
        }
        const reminder: Reminder = { at, key: crypto.randomUUID() };
        if (isAndroid) {
          while (used.has(nativeId)) nativeId++;
          reminder.nativeId = nativeId++;
          reminder.nativePending = true;
        }
        next[id] = reminder;
        pending.push({ id, reminder });
      }
      const before = localStorage.getItem(eventRemindersStorageKey);
      if (isAndroid && pending.length) {
        // Reserve IDs before calling Android so a retry can replace or cancel
        // the same alarms even if the native batch failed partway.
        saveReminders(next, eventRemindersStorageKey);
        await LocalNotifications.schedule({
          notifications: pending.map(({ id, reminder }) => ({
            id: reminder.nativeId!,
            title,
            body: genericBody,
            schedule: { at: new Date(reminder.at) },
            isExactNotification: false,
            extra: { eventReminderId: id },
          })),
        });
        for (const { reminder } of pending) delete reminder.nativePending;
      }
      saveReminders(next, eventRemindersStorageKey);
      changed = before !== localStorage.getItem(eventRemindersStorageKey);
      eventRemindersReady = true;
    });
  } finally {
    if (changed) announceChange();
  }
}

export async function cancelReminder(taskId: string) {
  await cancelReminders([taskId]);
}

export async function cancelReminders(taskIds: readonly string[]) {
  const cancelled = await withReminderLock(async () => {
    const reminders = readReminders();
    const scheduled = taskIds.filter((id) => Object.hasOwn(reminders, id));
    if (!scheduled.length) return false;
    if (isAndroid) {
      const notifications = scheduled.flatMap((taskId) => {
        const id = reminders[taskId].nativeId;
        return id === undefined ? [] : [{ id }];
      });
      if (notifications.length)
        await LocalNotifications.cancel({ notifications });
    }
    for (const id of scheduled) delete reminders[id];
    saveReminders(reminders);
    return true;
  });
  if (cancelled) announceChange();
}

export function reminderTag(key: string) {
  return "organify-reminder:" + key;
}

// El service worker deja aquí una marca por cada aviso push mostrado.
const deliveredCache = "organify-push-delivered";

function deliveredUrl(scope: string, key: string) {
  return new URL("__organify/push-delivered/" + key, scope).href;
}

async function consumePushDelivery(key: string) {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    if (!registration || !("caches" in window)) return false;
    const cache = await caches.open(deliveredCache);
    return await cache.delete(deliveredUrl(registration.scope, key));
  } catch {
    return false;
  }
}

function storageForReminder(id: string) {
  return isEventReminderId(id) ? eventRemindersStorageKey : remindersStorageKey;
}

function markDelivered(id: string, at: number) {
  const storage = storageForReminder(id);
  const reminders = readReminders(storage);
  const reminder = reminders[id];
  if (reminder?.at !== at) return;
  reminder.delivered = true;
  saveReminders(reminders, storage);
}

async function deliverDueReminders(onDelivered: (id: string) => void) {
  const reminders = eventRemindersReady
    ? { ...readReminders(), ...readReminders(eventRemindersStorageKey) }
    : readReminders();
  for (const [id, reminder] of Object.entries(reminders)) {
    if (reminder.delivered || reminder.at > Date.now()) continue;
    const isEvent = isEventReminderId(id);
    if (isEvent && reminder.at < Date.now() - eventReminderGrace) continue;
    // Si el aviso ya llegó por push con la app cerrada, no se repite.
    if (reminder.key && (await consumePushDelivery(reminder.key))) {
      markDelivered(id, reminder.at);
      continue;
    }
    if (window.__TAURI__) {
      await window.__TAURI__.core.invoke("show_reminder", {
        event: isEvent,
      });
    } else {
      if (!("Notification" in window) || Notification.permission !== "granted")
        return;
      const registration = await navigator.serviceWorker?.getRegistration();
      const tag = reminderTag(reminder.key ?? id);
      const body = isEvent ? genericBody : taskBody;
      if (registration?.active) {
        await registration.showNotification(title, {
          body,
          tag,
          icon: "./icon-192.png",
          data: { reminder: reminder.key },
        });
      } else {
        new Notification(title, { body, tag });
      }
    }
    markDelivered(id, reminder.at);
    // Retira el aviso del servidor push para que no vuelva a llegar.
    announceChange();
    onDelivered(id);
  }
}

interface WorkerMessage {
  type?: string;
  reminder?: string;
}

/** Abre la tarea indicada en `?reminder=` al pulsar un aviso con la app cerrada. */
function takeReminderFromUrl() {
  const url = new URL(location.href);
  const key = url.searchParams.get("reminder");
  if (!key) return undefined;
  url.searchParams.delete("reminder");
  history.replaceState(history.state, "", url);
  return key;
}

export function watchReminders(
  onDelivered: (taskId: string) => void,
  onOpen: (taskId: string) => void,
) {
  if (isAndroid) {
    const listener = LocalNotifications.addListener(
      "localNotificationActionPerformed",
      ({ notification }) => {
        const id: unknown = notification.extra?.eventReminderId;
        if (typeof id === "string" && isEventReminderId(id)) onOpen(id);
      },
    );
    void listener.catch((error: unknown) =>
      console.error("No se pudo escuchar el aviso.", error),
    );
    return () => {
      void listener.then(
        (handle) => handle.remove(),
        () => undefined,
      );
    };
  }
  let active = true;
  let running = false;
  function tick() {
    if (running) return;
    running = true;
    const run = () =>
      deliverDueReminders((taskId) => {
        if (active && document.visibilityState === "visible")
          onDelivered(taskId);
      });
    void withReminderLock(run)
      .catch((error: unknown) =>
        console.error("No se pudo mostrar el recordatorio.", error),
      )
      .finally(() => {
        running = false;
      });
  }

  function open(key: string) {
    const taskId = taskForReminder(key);
    if (taskId) onOpen(taskId);
  }

  function message(event: MessageEvent<WorkerMessage>) {
    const key = event.data?.reminder;
    if (!key) return;
    if (event.data.type === "organify:open-reminder") open(key);
    if (event.data.type !== "organify:reminder") return;
    const taskId = taskForReminder(key);
    if (!taskId) return;
    void withReminderLock(async () => {
      const reminder = readReminders(storageForReminder(taskId))[taskId];
      if (!reminder || reminder.key !== key || reminder.delivered) return;
      await consumePushDelivery(key);
      markDelivered(taskId, reminder.at);
      if (active && document.visibilityState === "visible") onDelivered(taskId);
    });
  }

  const initial = takeReminderFromUrl();
  if (initial) open(initial);
  tick();
  const timer = window.setInterval(tick, 5_000);
  window.addEventListener("focus", tick);
  navigator.serviceWorker?.addEventListener("message", message);
  return () => {
    active = false;
    window.clearInterval(timer);
    window.removeEventListener("focus", tick);
    navigator.serviceWorker?.removeEventListener("message", message);
  };
}
