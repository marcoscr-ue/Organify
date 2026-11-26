import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Button } from "@/components/ui/button";
import { CloseDialogButton } from "./app-overlays";
import { syncConnectionMessage } from "./sync-connection";
import {
  acceptWorkspace,
  connectWorkspace,
  createWorkspace,
  inviteToWorkspace,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
  type ConnectedWorkspace,
  type WorkspaceMember,
  type WorkspaceSession,
} from "./workspace-connection";

type WorkspaceSyncState = "pending" | "synced" | "error";

export function useSharedWorkspaces(session: WorkspaceSession | undefined) {
  const [result, setResult] = useState<{
    session: WorkspaceSession;
    spaces: ConnectedWorkspace[];
    error?: string;
  }>();
  const [statuses, setStatuses] = useState<Record<string, WorkspaceSyncState>>(
    {},
  );
  const refreshRef = useRef<() => Promise<ConnectedWorkspace[]>>(
    async () => [],
  );
  const refresh = useCallback(() => refreshRef.current(), []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    const connections = new Map<
      string,
      { space: ConnectedWorkspace; stop: () => void }
    >();
    let pending: Promise<ConnectedWorkspace[]> | undefined;
    function refreshSpaces() {
      pending ??= reconcile().finally(() => {
        pending = undefined;
      });
      return pending;
    }

    async function reconcile() {
      try {
        const found = await listWorkspaces(session!);
        if (!active) return [];
        const memberships = new Set(found.map((space) => space.membershipId));
        for (const [id, connection] of connections) {
          if (!memberships.has(id)) {
            connection.stop();
            connections.delete(id);
          }
        }
        const spaces = found.map((entry) => {
          const existing = connections.get(entry.membershipId);
          if (existing) return existing.space;
          const space = connectWorkspace(session!, entry);
          const id = space.membershipId;
          const updateStatus = (status: WorkspaceSyncState) =>
            setStatuses((old) =>
              old[id] === status ? old : { ...old, [id]: status },
            );
          updateStatus("pending");
          const stop = space.engine.start(
            (error) => {
              updateStatus("error");
              if (
                typeof error === "object" &&
                error &&
                "code" in error &&
                error.code === "42501"
              ) {
                connections.get(id)?.stop();
                connections.delete(id);
                setResult({ session: session!, spaces: currentSpaces() });
                refreshSoon();
              }
            },
            () => updateStatus("synced"),
          );
          connections.set(id, { space, stop });
          return space;
        });
        setResult({ session: session!, spaces });
        return spaces;
      } catch (error) {
        if (active)
          setResult({
            session: session!,
            spaces: currentSpaces(),
            error: syncConnectionMessage(error),
          });
        throw error;
      }
    }

    function currentSpaces() {
      return Array.from(connections.values(), ({ space }) => space);
    }

    function refreshSoon() {
      void refreshSpaces().catch(() => {});
    }
    refreshRef.current = refreshSpaces;
    refreshSoon();
    const timer = window.setInterval(refreshSoon, 15_000);
    window.addEventListener("online", refreshSoon);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener("online", refreshSoon);
      for (const { stop } of connections.values()) stop();
      refreshRef.current = async () => [];
    };
  }, [session]);

  return {
    spaces: result?.session === session ? (result?.spaces ?? []) : [],
    error: result?.session === session ? result?.error : undefined,
    statuses,
    refresh,
  };
}

export interface WorkspacePickerHandle {
  open: () => void;
}

type WorkspacePickerProps = {
  session?: WorkspaceSession;
  spaces: ConnectedWorkspace[];
  space?: ConnectedWorkspace;
  error?: string;
  status?: WorkspaceSyncState;
  disabled: boolean;
  onSelect: (id?: string) => void;
  refresh: () => Promise<ConnectedWorkspace[]>;
};

export const WorkspacePicker = forwardRef<
  WorkspacePickerHandle,
  WorkspacePickerProps
>(function WorkspacePicker(
  { session, spaces, space, error, status, disabled, onSelect, refresh },
  ref,
) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [mode, setMode] = useState<"create" | "accept" | "manage">("create");
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [remove, setRemove] = useState<WorkspaceMember>();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [context, setContext] = useState<{
    session: WorkspaceSession;
    space?: ConnectedWorkspace;
  }>();

  const run = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setMessage("");
    try {
      await action();
    } catch (cause) {
      setMessage(syncConnectionMessage(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const open = useCallback(() => {
    if (!session) return;
    const selected = space?.owner ? space : undefined;
    setContext({ session, space: selected });
    setCode("");
    setMessage("");
    setMembers([]);
    setRemove(undefined);
    setMode(selected ? "manage" : "create");
    dialog.current?.showModal();
    if (selected)
      void run(async () =>
        setMembers(await listWorkspaceMembers(session, selected.id)),
      );
  }, [session, space, run]);

  useImperativeHandle(ref, () => ({ open }), [open]);

  const hasAccess =
    context?.session === session &&
    (!context?.space ||
      spaces.some(
        ({ membershipId }) => membershipId === context.space?.membershipId,
      ));

  useEffect(() => {
    if (!hasAccess) dialog.current?.close();
  }, [hasAccess]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!context || !hasAccess || busy) return;
    const form = event.currentTarget;
    const input = String(new FormData(form).get("value") ?? "").trim();
    if (!input) return;
    void run(async () => {
      if (mode === "manage" && context.space) {
        setCode(await inviteToWorkspace(context.session, context.space, input));
        form.reset();
        return;
      }
      const id =
        mode === "accept"
          ? await acceptWorkspace(context.session, input)
          : await createWorkspace(context.session, input);
      form.reset();
      let next: ConnectedWorkspace[];
      try {
        next = await refresh();
        if (!next.some((entry) => entry.id === id)) next = await refresh();
      } catch {
        setMessage(
          "El espacio se ha guardado. Aparecerá cuando se recupere la conexión.",
        );
        return;
      }
      if (next.some((entry) => entry.id === id)) onSelect(id);
      dialog.current?.close();
    });
  }

  return (
    <div className="grid gap-2">
      <label className="grid gap-1">
        <span className="sidebar-label">Espacio de trabajo</span>
        <select
          className="field min-w-0 w-full"
          value={space?.id ?? ""}
          disabled={disabled}
          onChange={(event) => onSelect(event.target.value || undefined)}
        >
          <option value="">Personal</option>
          {spaces.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </label>
      {session && (
        <button
          type="button"
          className="nav-link text-left"
          onClick={open}
          disabled={disabled}
        >
          Espacios compartidos
        </button>
      )}
      {space && (
        <p role="status" className="px-2 text-xs text-muted">
          {status === "error"
            ? "Sincronización interrumpida. Los cambios se guardan en este dispositivo."
            : status === "synced"
              ? "Espacio sincronizado."
              : "Sincronizando espacio."}
        </p>
      )}
      <dialog
        ref={dialog}
        aria-label="Espacios compartidos"
        className="m-auto w-[min(30rem,calc(100%-2rem))] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-xl border border-line bg-paper p-5 text-foreground shadow-xl backdrop:bg-black/35"
        onClose={() => {
          setCode("");
          setContext(undefined);
        }}
        onCancel={(event) => {
          if (busy) event.preventDefault();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">Espacios compartidos</h2>
          <CloseDialogButton
            disabled={busy}
            onClick={() => dialog.current?.close()}
          />
        </div>
        {hasAccess && context && (
          <div className="mt-4 grid gap-4 text-sm">
            <div
              className="flex flex-wrap gap-2"
              aria-label="Acciones del espacio"
            >
              <Button
                type="button"
                className="border border-line bg-paper text-foreground hover:bg-panel aria-pressed:bg-panel"
                disabled={busy}
                aria-pressed={mode === "create"}
                onClick={() => {
                  setMode("create");
                  setMessage("");
                }}
              >
                Crear espacio
              </Button>
              <Button
                type="button"
                className="border border-line bg-paper text-foreground hover:bg-panel aria-pressed:bg-panel"
                disabled={busy}
                aria-pressed={mode === "accept"}
                onClick={() => {
                  setMode("accept");
                  setMessage("");
                }}
              >
                Aceptar invitación
              </Button>
              {context.space && (
                <Button
                  type="button"
                  className="border border-line bg-paper text-foreground hover:bg-panel aria-pressed:bg-panel"
                  disabled={busy}
                  aria-pressed={mode === "manage"}
                  onClick={() => {
                    setMode("manage");
                    setMessage("");
                  }}
                >
                  Gestionar acceso
                </Button>
              )}
            </div>
            <form key={mode} className="grid gap-2" onSubmit={submit}>
              <label className="grid gap-1">
                {mode === "create"
                  ? "Nombre del espacio"
                  : mode === "accept"
                    ? "Código de invitación"
                    : "Correo de la cuenta invitada"}
                <input
                  className="field min-w-0"
                  name="value"
                  autoComplete="off"
                  type={
                    mode === "manage"
                      ? "email"
                      : mode === "accept"
                        ? "password"
                        : "text"
                  }
                  maxLength={mode === "manage" ? 254 : 120}
                  required
                />
              </label>
              <Button type="submit" disabled={busy}>
                {mode === "create"
                  ? "Crear"
                  : mode === "accept"
                    ? "Unirme al espacio"
                    : "Generar invitación"}
              </Button>
            </form>
            {mode === "manage" && context.space && (
              <>
                {code && (
                  <label className="grid gap-1">
                    Envía este código a la persona invitada por un canal
                    privado. Caduca en 48 horas y se puede usar una vez.
                    <input
                      className="field min-w-0"
                      readOnly
                      value={code}
                      onFocus={(event) => event.currentTarget.select()}
                    />
                  </label>
                )}
                <h3 className="font-semibold">
                  Miembros de {context.space.name}
                </h3>
                {members.length ? (
                  <ul className="grid gap-2">
                    {members.map((member) => (
                      <li
                        key={member.membership_id}
                        className="flex items-center justify-between gap-2"
                      >
                        <span className="min-w-0 wrap-anywhere">
                          {member.email}
                        </span>
                        <Button
                          type="button"
                          className="border border-line bg-paper text-foreground hover:bg-panel aria-pressed:bg-panel"
                          disabled={busy}
                          onClick={() => setRemove(member)}
                        >
                          Retirar acceso
                        </Button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted">Todavía no hay otros miembros.</p>
                )}
                {remove && (
                  <div className="grid gap-2 rounded border border-line p-3">
                    <p>
                      ¿Retirar el acceso de {remove.email}? Conservará los datos
                      que haya descargado.
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="border border-line bg-paper text-foreground hover:bg-panel aria-pressed:bg-panel"
                        disabled={busy}
                        onClick={() => setRemove(undefined)}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          const space = context.space!;
                          void run(async () => {
                            await removeWorkspaceMember(
                              context.session,
                              space.id,
                              remove.membership_id,
                            );
                            setMembers((old) =>
                              old.filter(
                                (member) =>
                                  member.membership_id !== remove.membership_id,
                              ),
                            );
                            setRemove(undefined);
                          });
                        }}
                      >
                        Confirmar
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
            {(message || error) && <p role="status">{message || error}</p>}
          </div>
        )}
      </dialog>
    </div>
  );
});
