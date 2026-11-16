import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { Project, ProjectChanges } from "@organify/core";
import { Button } from "@/components/ui/button";
import { CloseDialogButton } from "./app-overlays";

type ProjectAction = "rename" | "customize";

export function ProjectNavigation({
  project,
  active,
  open,
  save,
}: {
  project: Project;
  active: boolean;
  open: () => void;
  save: (changes: ProjectChanges) => Promise<void>;
}) {
  const [hovered, setHovered] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [action, setAction] = useState<ProjectAction>();
  const row = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!hovered) return;
    function shortcut(event: KeyboardEvent) {
      const target = event.target;
      if (
        event.key.toLowerCase() !== "r" ||
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey ||
        (target instanceof HTMLElement &&
          (target.isContentEditable ||
            target.closest("input, textarea, select"))) ||
        document.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      setMenuOpen(false);
      setAction("rename");
    }
    document.addEventListener("keydown", shortcut);
    return () => document.removeEventListener("keydown", shortcut);
  }, [hovered]);

  useEffect(() => {
    if (!menuOpen) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !row.current?.contains(event.target))
        setMenuOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menuOpen]);

  function choose(next: ProjectAction) {
    trigger.current?.focus();
    setMenuOpen(false);
    setAction(next);
  }

  return (
    <div
      ref={row}
      className="group/project w-full min-w-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onKeyDown={(event) => {
        if (menuOpen && event.key === "Escape") {
          setMenuOpen(false);
          trigger.current?.focus();
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setMenuOpen(false);
      }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <button
          type="button"
          aria-current={active ? "page" : undefined}
          className="nav-link flex min-w-0 flex-1 items-center gap-2"
          onClick={open}
        >
          {project.color && (
            <span
              aria-hidden="true"
              className="size-2.5 shrink-0 rounded-full border border-foreground/30"
              style={{ backgroundColor: project.color }}
            />
          )}
          <span className="min-w-0 break-words">{project.name}</span>
        </button>
        <button
          ref={trigger}
          type="button"
          aria-label={`Opciones de ${project.name}`}
          aria-expanded={menuOpen}
          aria-controls={menuId}
          className="nav-link grid size-8 shrink-0 place-items-center p-0 [@media(hover:hover)]:opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100 aria-expanded:opacity-100"
          onClick={() => setMenuOpen(!menuOpen)}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5 fill-current"
          >
            <circle cx="5" cy="12" r="1.7" />
            <circle cx="12" cy="12" r="1.7" />
            <circle cx="19" cy="12" r="1.7" />
          </svg>
        </button>
      </div>
      <div
        id={menuId}
        hidden={!menuOpen}
        className="mt-1 rounded-lg border border-line bg-paper shadow-sm"
      >
        <button
          type="button"
          className="nav-link flex w-full items-center justify-between gap-2"
          aria-keyshortcuts="R"
          onClick={() => choose("rename")}
        >
          Renombrar <kbd className="text-muted">R</kbd>
        </button>
        <button
          type="button"
          className="nav-link w-full"
          onClick={() => choose("customize")}
        >
          Personalizar
        </button>
      </div>
      {action && (
        <ProjectDialog
          action={action}
          project={project}
          save={save}
          close={() => setAction(undefined)}
        />
      )}
    </div>
  );
}

function ProjectDialog({
  action,
  project,
  save,
  close,
}: {
  action: ProjectAction;
  project: Project;
  save: (changes: ProjectChanges) => Promise<void>;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color ?? "#315abb");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const renaming = action === "rename";

  useLayoutEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    return () => modal?.close();
  }, []);

  function dismiss() {
    dialog.current?.close();
    close();
  }

  async function submit(changes: ProjectChanges) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      await save(changes);
      dismiss();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "No se pudo guardar el proyecto.",
      );
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100%-2rem))] overflow-y-auto rounded-xl border border-line bg-paper p-5 text-foreground shadow-xl backdrop:bg-black/35"
      onCancel={(event) => {
        event.preventDefault();
        if (!saving) dismiss();
      }}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id={titleId} className="min-w-0 break-words text-lg font-semibold">
          {renaming ? "Renombrar proyecto" : `Personalizar «${project.name}»`}
        </h2>
        <CloseDialogButton onClick={dismiss} disabled={saving} />
      </div>
      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(renaming ? { name } : { color });
        }}
      >
        {renaming ? (
          <label className="grid gap-1 text-sm">
            Nombre del proyecto
            <input
              autoFocus
              required
              disabled={saving}
              className="field min-w-0"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        ) : (
          <label className="flex items-center gap-3 text-sm">
            <input
              autoFocus
              type="color"
              disabled={saving}
              className="h-10 w-14 cursor-pointer rounded-md border border-line p-1"
              value={color}
              onChange={(event) => setColor(event.target.value)}
            />
            Color del proyecto
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={saving}>
            Guardar
          </Button>
          {!renaming && project.color && (
            <button
              type="button"
              className="nav-link"
              disabled={saving}
              onClick={() => void submit({ color: undefined })}
            >
              Quitar color
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}
