import { Dialog } from "@/components/ui/dialog";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { CloseDialogButton } from "./app-overlays";

export function ProjectCreationDialog({
  save,
  close,
}: {
  save: (name: string, color: string) => Promise<void>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState("");
  const [color, setColor] = useState("#315abb");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useLayoutEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => modal?.close();
  }, []);

  return (
    <Dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-line bg-paper p-5 text-foreground shadow-xl backdrop:bg-black/35"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) close();
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-lg font-semibold">
          Crear proyecto
        </h2>
        <CloseDialogButton onClick={close} disabled={saving} />
      </div>
      <form
        className="grid gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving || !name.trim()) return;
          setSaving(true);
          setError("");
          try {
            await save(name.trim(), color);
            close();
          } catch (cause) {
            setError(
              cause instanceof Error
                ? cause.message
                : "No se pudo crear el proyecto.",
            );
            setSaving(false);
          }
        }}
      >
        <label className="grid gap-1 text-sm">
          Título
          <input
            autoFocus
            required
            className="field min-w-0"
            value={name}
            disabled={saving}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="flex items-center gap-3 text-sm">
          <input
            type="color"
            className="h-10 w-14 cursor-pointer rounded-md border border-line p-1"
            value={color}
            disabled={saving}
            onChange={(event) => setColor(event.target.value)}
          />
          Color
        </label>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            className="border border-line bg-paper text-foreground hover:bg-panel"
            disabled={saving}
            onClick={close}
          >
            Cancelar
          </Button>
          <Button type="submit" disabled={saving || !name.trim()}>
            {saving ? "Creando…" : "Crear proyecto"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
