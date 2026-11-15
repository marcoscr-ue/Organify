import { useState, type FormEvent } from "react";
import { localStamp } from "./calendar-schedule";
import {
  cancelReminder,
  isAndroid,
  reminderTime,
  scheduleReminder,
} from "./reminders";
import { Button } from "@/components/ui/button";

export function ReminderForm({ taskId }: { taskId: string }) {
  const [scheduled, setScheduled] = useState(() => reminderTime(taskId));
  const [value, setValue] = useState(() =>
    scheduled ? localStamp(new Date(scheduled)).slice(0, 16) : "",
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function update(at?: number) {
    setBusy(true);
    try {
      if (at === undefined) {
        await cancelReminder(taskId);
        setValue("");
      } else {
        await scheduleReminder(taskId, at);
      }
      setScheduled(at);
      setMessage(
        at === undefined
          ? "Recordatorio cancelado."
          : "Recordatorio programado.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo guardar el recordatorio.",
      );
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy) void update(new Date(value).getTime());
  }

  return (
    <form
      className="mt-4 grid gap-2 border-t border-line pt-4 text-sm"
      onSubmit={submit}
    >
      <label className="grid gap-1">
        Recordatorio en este dispositivo
        <input
          className="field min-w-0"
          type="datetime-local"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          required
        />
      </label>
      <p className="text-muted">
        {isAndroid
          ? "Android puede retrasar el aviso para ahorrar batería."
          : "Mantén la aplicación abierta para recibir el aviso."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>
          Programar
        </Button>
        {scheduled !== undefined && (
          <Button type="button" disabled={busy} onClick={() => void update()}>
            Cancelar recordatorio
          </Button>
        )}
      </div>
      {scheduled !== undefined && (
        <p>Programado para {new Date(scheduled).toLocaleString("es")}</p>
      )}
      <p role="status">{message}</p>
    </form>
  );
}
