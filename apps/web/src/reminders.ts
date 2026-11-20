import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";

export const isAndroid = Capacitor.getPlatform() === "android";
const storageKey = "organify.local-reminders.v1";
const title = "Organify";
const body = "Tienes una tarea pendiente.";

interface Reminder {
  at: number;
  nativeId?: number;
}

function readReminders(): Record<string, Reminder> {
  return JSON.parse(localStorage.getItem(storageKey) ?? "{}") as Record<
    string,
    Reminder
  >;
}

function writeReminder(taskId: string, value?: Reminder) {
  const reminders = readReminders();
  if (value) reminders[taskId] = value;
  else delete reminders[taskId];
  localStorage.setItem(storageKey, JSON.stringify(reminders));
}

async function withReminderLock(run: () => void | Promise<void>) {
  if (navigator.locks) await navigator.locks.request("organify-reminders", run);
  else await run();
}

export function reminderTime(taskId: string) {
  const at = readReminders()[taskId]?.at;
  return at && at > Date.now() ? at : undefined;
}

export async function scheduleReminder(taskId: string, at: number) {
  if (!Number.isFinite(at) || at <= Date.now()) {
    throw new Error("Elige una fecha y hora futuras.");
  }

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
      writeReminder(taskId, { at, nativeId: id });
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
  await withReminderLock(() => writeReminder(taskId, { at }));
}

export async function cancelReminder(taskId: string) {
  await cancelReminders([taskId]);
}

export async function cancelReminders(taskIds: readonly string[]) {
  await withReminderLock(async () => {
    const reminders = readReminders();
    const scheduled = taskIds.filter((id) => Object.hasOwn(reminders, id));
    if (!scheduled.length) return;
    if (isAndroid) {
      const notifications = scheduled.flatMap((taskId) => {
        const id = reminders[taskId].nativeId;
        return id === undefined ? [] : [{ id }];
      });
      if (notifications.length)
        await LocalNotifications.cancel({ notifications });
    }
    for (const id of scheduled) delete reminders[id];
    localStorage.setItem(storageKey, JSON.stringify(reminders));
  });
}

async function deliverDueReminders(onDelivered: (taskId: string) => void) {
  for (const [taskId, reminder] of Object.entries(readReminders())) {
    if (reminder.at > Date.now()) continue;
    if (window.__TAURI__) {
      await window.__TAURI__.core.invoke("show_reminder");
    } else {
      if (!("Notification" in window) || Notification.permission !== "granted")
        return;
      const registration = await navigator.serviceWorker?.getRegistration();
      if (registration?.active) {
        await registration.showNotification(title, { body, tag: taskId });
      } else {
        new Notification(title, { body, tag: taskId });
      }
    }
    if (readReminders()[taskId]?.at === reminder.at) writeReminder(taskId);
    onDelivered(taskId);
  }
}

export function watchReminders(onDelivered: (taskId: string) => void) {
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

  tick();
  const timer = window.setInterval(tick, 5_000);
  window.addEventListener("focus", tick);
  return () => {
    active = false;
    window.clearInterval(timer);
    window.removeEventListener("focus", tick);
  };
}
