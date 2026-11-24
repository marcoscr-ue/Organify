import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { detectPushAvailability, isIosDevice } from "./push-support";

const iphone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const ipad =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15";
const android =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";

describe("disponibilidad de avisos push", () => {
  it("reconoce iPhone y iPad, que se presenta como Mac", () => {
    expect(isIosDevice(iphone, 5)).toBe(true);
    expect(isIosDevice(ipad, 5)).toBe(true);
    expect(isIosDevice(ipad, 0)).toBe(false);
    expect(isIosDevice(android, 5)).toBe(false);
  });

  it("en iOS exige la app añadida a la pantalla de inicio", () => {
    const base = { native: false, ios: true, push: false };
    expect(detectPushAvailability({ ...base, standalone: false })).toBe(
      "install-required",
    );
    // iOS anterior a 16.4: instalada, pero sin PushManager.
    expect(detectPushAvailability({ ...base, standalone: true })).toBe(
      "unsupported",
    );
    expect(
      detectPushAvailability({ ...base, standalone: true, push: true }),
    ).toBe("available");
  });

  it("en Android funciona también desde el navegador", () => {
    expect(
      detectPushAvailability({
        native: false,
        ios: false,
        standalone: false,
        push: true,
      }),
    ).toBe("available");
  });

  it("deja Tauri y Capacitor con sus avisos nativos", () => {
    expect(
      detectPushAvailability({
        native: true,
        ios: false,
        standalone: true,
        push: true,
      }),
    ).toBe("native");
  });
});

describe("recordatorios para push", () => {
  const saved = new Map<string, string>();
  const changed = vi.fn();

  beforeEach(() => {
    saved.clear();
    changed.mockClear();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    });
    const notification = { requestPermission: async () => "granted" };
    vi.stubGlobal("Notification", notification);
    vi.stubGlobal("window", {
      Notification: notification,
      dispatchEvent: (event: Event) => changed(event.type),
    });
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 24, 12) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function load() {
    vi.resetModules();
    return import("./reminders");
  }

  it("programa avisos con un identificador aleatorio y avisa del cambio", async () => {
    const reminders = await load();
    const at = Date.now() + 60_000;
    await reminders.scheduleReminder("task-1", at);
    expect(reminders.reminderTime("task-1")).toBe(at);
    expect(changed).toHaveBeenCalledWith(reminders.remindersChangedEvent);

    const list = await reminders.pushReminderList();
    expect(list).toEqual([
      {
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        at: new Date(at).toISOString(),
      },
    ]);
    // El servidor no recibe el id de la tarea.
    expect(list[0].id).not.toContain("task-1");
    expect(reminders.taskForReminder(list[0].id)).toBe("task-1");

    await reminders.cancelReminders(["task-1"]);
    expect(await reminders.pushReminderList()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("asigna identificador a los avisos guardados por versiones anteriores", async () => {
    const at = Date.now() + 60_000;
    saved.set(
      "organify.local-reminders.v1",
      JSON.stringify({ old: { at }, past: { at: Date.now() - 1 } }),
    );
    const reminders = await load();
    const [first] = await reminders.pushReminderList();
    expect(first.at).toBe(new Date(at).toISOString());
    // El identificador se conserva entre llamadas.
    expect(await reminders.pushReminderList()).toEqual([first]);
    expect(reminders.taskForReminder(first.id)).toBe("old");
  });

  it("excluye los avisos entregados y los purga tras una semana", async () => {
    const week = 7 * 24 * 60 * 60 * 1000;
    saved.set(
      "organify.local-reminders.v1",
      JSON.stringify({
        delivered: { at: Date.now() + 60_000, key: "k1", delivered: true },
        stale: { at: Date.now() - week - 1, key: "k2", delivered: true },
      }),
    );
    const reminders = await load();
    expect(reminders.reminderTime("delivered")).toBeUndefined();
    await reminders.scheduleReminder("task", Date.now() + 1_000);
    expect(reminders.taskForReminder("k1")).toBe("delivered");
    expect(reminders.taskForReminder("k2")).toBeUndefined();
    expect((await reminders.pushReminderList()).length).toBe(1);
  });
});
