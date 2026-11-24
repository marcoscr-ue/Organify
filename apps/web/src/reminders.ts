import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export const isAndroid = Capacitor.getPlatform() === "android";
export const remindersStorageKey = "organify.local-reminders.v1";
export const remindersChangedEvent = "organify:reminders-changed";
const title = "Organify";
const body = "Tienes una tarea pendiente.";
// Los avisos ya entregados se conservan una semana para abrir la tarea desde
// la notificación.
const keepDelivered = 7 * 24 * 60 * 60 * 1000;

interface Reminder {
  at: number;
  nativeId?: number;
  /** Identificador aleatorio del aviso. También identifica el push. */
  key?: string;
  delivered?: boolean;
}

export interface PushReminder {
  id: string;
  at: string;
}

function readReminders(): Record<string, Reminder> {
  return JSON.parse(
    localStorage.getItem(remindersStorageKey) ?? "{}",
  ) as Record<string, Reminder>;
}

function saveReminders(reminders: Record<string, Reminder>) {
  const oldest = Date.now() - keepDelivered;
  for (const [taskId, reminder] of Object.entries(reminders)) {
    if (reminder.at < oldest) delete reminders[taskId];
  }
  localStorage.setItem(remindersStorageKey, JSON.stringify(reminders));
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

async function withReminderLock<T>(run: () => T | Promise<T>): Promise<T> {
  if (navigator.locks)
    return navigator.locks.request("organify-reminders", run) as Promise<T>;
  return run();
}

export function reminderTime(taskId: string) {
  const reminder = readReminders()[taskId];
  return reminder && !reminder.delivered && reminder.at > Date.now()
    ? reminder.at
    : undefined;
}

/** Tarea asociada a un aviso, incluso si ya se entregó. */
export function taskForReminder(key: string) {
  return Object.entries(readReminders()).find(
    ([, reminder]) => reminder.key === key,
  )?.[0];
}

/** Avisos futuros que deben programarse en el servidor push. */
export async function pushReminderList(): Promise<PushReminder[]> {
  return withReminderLock(() => {
    const reminders = readReminders();
    let changed = false;
    const now = Date.now();
    const list: PushReminder[] = [];
    for (const reminder of Object.values(reminders)) {
      if (reminder.delivered || reminder.at <= now) continue;
      if (!reminder.key) {
        reminder.key = crypto.randomUUID();
        changed = true;
      }
      list.push({ id: reminder.key, at: new Date(reminder.at).toISOString() });
    }
    if (changed) saveReminders(reminders);
    return list;
  });
}

export async function scheduleReminder(taskId: string, at: number) {
  if (!Number.isFinite(at) || at <= Date.now()) {
    throw new Error("Elige una fecha y hora futuras.");
  }
  const key = crypto.randomUUID();

  if (isAndroid) {
    let { display } = await LocalNotifications.checkPermissions();
    if (display !== "granted") {
      ({ display } = await LocalNotifications.requestPermissions());
    }
    if (display !== "granted")
      throw new Error("Permite las notificaciones en Android.");
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
            body,
            schedule: { at: new Date(at) },
            isExactNotification: false,
          },
        ],
      });
      writeReminder(taskId, { at, nativeId: id, key });
    });
    return;
  }

  if (!window.__TAURI__) {
    if (!("Notification" in window))
      throw new Error("Este navegador no admite avisos locales.");
    if ((await Notification.requestPermission()) !== "granted") {
      throw new Error("Permite las notificaciones en el navegador.");
    }
  }
  await withReminderLock(() => writeReminder(taskId, { at, key }));
  announceChange();
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

function markDelivered(taskId: string, at: number) {
  const reminders = readReminders();
  const reminder = reminders[taskId];
  if (reminder?.at !== at) return;
  reminder.delivered = true;
  saveReminders(reminders);
}

async function deliverDueReminders(onDelivered: (taskId: string) => void) {
  for (const [taskId, reminder] of Object.entries(readReminders())) {
    if (reminder.delivered || reminder.at > Date.now()) continue;
    // Si el aviso ya llegó por push con la app cerrada, no se repite.
    if (reminder.key && (await consumePushDelivery(reminder.key))) {
      markDelivered(taskId, reminder.at);
      continue;
    }
    if (window.__TAURI__) {
      await window.__TAURI__.core.invoke("show_reminder");
    } else {
      if (!("Notification" in window) || Notification.permission !== "granted")
        return;
      const registration = await navigator.serviceWorker?.getRegistration();
      const tag = reminderTag(reminder.key ?? taskId);
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
    markDelivered(taskId, reminder.at);
    // Retira el aviso del servidor push para que no vuelva a llegar.
    announceChange();
    onDelivered(taskId);
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
  if (isAndroid) return;
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
      const reminder = readReminders()[taskId];
      if (!reminder || reminder.delivered) return;
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
