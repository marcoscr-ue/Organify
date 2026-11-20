import { useCallback, useEffect, useState, type FormEvent } from "react";
import { isSyncProtocolError, type SyncEngine } from "@organify/sync";
import {
  createDeviceUnlockStore,
  type TaskRepositories,
} from "@organify/storage";
import { Button } from "@/components/ui/button";
import { canRememberUnlock, protectDeviceUnlock } from "./device-unlock";
import {
  createAccountClient,
  protocolMessage,
  readSyncProject,
  resumeSync,
  syncConnectionMessage,
  unlockSync,
  type SyncProject,
} from "./sync-connection";

const projectStorageKey = "organify:sync-project";

function readInstalledClient() {
  try {
    return createAccountClient(
      readSyncProject(
        import.meta.env.VITE_SUPABASE_URL ?? "",
        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
      ),
    );
  } catch {
    return undefined;
  }
}

function readSavedClient() {
  try {
    const project: SyncProject = JSON.parse(
      localStorage.getItem(projectStorageKey) ?? "null",
    );
    return createAccountClient(readSyncProject(project.url, project.publicKey));
  } catch {
    return undefined;
  }
}

const installedClient = readInstalledClient();
const initialClient = installedClient ?? readSavedClient();
const deviceUnlockStore = canRememberUnlock()
  ? createDeviceUnlockStore()
  : undefined;

export type SyncStatus = "inactive" | "pending" | "synced" | "error";

export function SyncSettings({
  store,
  status,
  onStatus,
}: {
  store: TaskRepositories["sync"];
  status: SyncStatus;
  onStatus: (status: SyncStatus) => void;
}) {
  const [client, setClient] = useState(initialClient);
  const [account, setAccount] = useState<{
    email: string;
    rememberSession: boolean;
  }>();
  const [rememberLogin, setRememberLogin] = useState(false);
  const [rememberedUnlock, setRememberedUnlock] = useState(false);
  const [retryRestore, setRetryRestore] = useState(false);
  const [restoreAttempt, setRestoreAttempt] = useState(0);
  const [stopSync, setStopSync] = useState<() => void>();
  const [restoring, setRestoring] = useState(Boolean(initialClient));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState("");

  const startSync = useCallback(
    (engine: SyncEngine) => {
      const stop = engine.start(
        (error) => {
          onStatus("error");
          if (isSyncProtocolError(error)) {
            stop();
            setStopSync(undefined);
            setMessage(protocolMessage);
          }
        },
        () => onStatus("synced"),
      );
      setStopSync(() => stop);
    },
    [onStatus],
  );

  useEffect(() => stopSync, [stopSync]);
  useEffect(() => {
    if (!client) return;
    let active = true;
    void client.api.auth
      .getSession()
      .then(async ({ data, error }) => {
        if (!active) return;
        if (error) throw error;
        if (!data.session) {
          setAccount(undefined);
          setRememberedUnlock(false);
          return;
        }
        const user = data.session.user;
        setAccount({ email: user.email ?? "", rememberSession: true });
        const saved = await deviceUnlockStore?.read(client.projectUrl);
        if (!active) return;
        setRememberedUnlock(saved?.userId === user.id);
        if (saved?.userId !== user.id) return;
        onStatus("pending");
        const engine = await resumeSync(client.api, store, saved);
        if (active) startSync(engine);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setMessage(syncConnectionMessage(error));
        setRetryRestore(true);
        onStatus("error");
      })
      .finally(() => {
        if (active) setRestoring(false);
      });
    return () => {
      active = false;
    };
  }, [client, onStatus, restoreAttempt, startSync, store]);

  const restoreAgain = useCallback(() => {
    setMessage("");
    setRetryRestore(false);
    setRestoring(true);
    onStatus("inactive");
    setRestoreAttempt((attempt) => attempt + 1);
  }, [onStatus]);

  useEffect(() => {
    if (!retryRestore || busy) return;
    window.addEventListener("online", restoreAgain);
    return () => window.removeEventListener("online", restoreAgain);
  }, [busy, restoreAgain, retryRestore]);

  function saveProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try {
      const project = readSyncProject(
        String(data.get("url")),
        String(data.get("publicKey")),
      );
      setClient(createAccountClient(project));
      setRestoring(true);
      setMessage("");
      onStatus("inactive");
      try {
        localStorage.setItem(projectStorageKey, JSON.stringify(project));
      } catch {
        onStatus("error");
        setMessage(
          "La configuración se conservará hasta que cierres o recargues la app.",
        );
      }
    } catch (error) {
      onStatus("error");
      setMessage(syncConnectionMessage(error));
    }
  }

  if (!client) {
    return (
      <form className="grid min-w-0 gap-2 text-sm" onSubmit={saveProject}>
        <h3 className="font-semibold">Configurar Supabase</h3>
        <label className="grid gap-1">
          URL del proyecto
          <input className="field min-w-0" name="url" type="url" required />
        </label>
        <label className="grid gap-1">
          Clave pública del proyecto
          <input
            className="field min-w-0"
            name="publicKey"
            autoComplete="off"
            placeholder="sb_publishable_…"
            required
          />
        </label>
        <Button type="submit">Guardar configuración</Button>
        {message && <p role="status">{message}</p>}
      </form>
    );
  }
  const { api, projectUrl, setRememberSession } = client;

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || restoring) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");
    const secret = String(data.get("secret"));
    const method =
      data.get("method") === "recovery" ? "recovery" : "passphrase";
    const initialize = data.get("initialize") === "on";
    const rememberSession = account?.rememberSession ?? rememberLogin;
    const rememberUnlock =
      rememberSession && data.get("rememberUnlock") === "on";
    if (
      method === "passphrase" &&
      (password === secret || secret.trim().length < 12)
    ) {
      onStatus("error");
      setMessage(
        "Usa una frase de cifrado distinta de la contraseña y de al menos 12 caracteres.",
      );
      return;
    }

    setBusy(true);
    setMessage("");
    setRetryRestore(false);
    onStatus("pending");
    try {
      if (!account) setRememberSession(rememberSession);
      const { data: login, error } = account
        ? await api.auth.getUser()
        : await api.auth.signInWithPassword({ email, password });
      if (error) throw error;
      const userId = login.user.id;
      setAccount({ email: login.user.email ?? email, rememberSession });
      const { engine, recoveryKey, key, envelopeId } = await unlockSync(
        api,
        store,
        userId,
        secret,
        method,
        initialize,
      );
      if (recoveryKey) setRecovery(recoveryKey);
      if (deviceUnlockStore) {
        try {
          if (rememberUnlock) {
            const saved = await protectDeviceUnlock(
              { projectUrl, userId, envelopeId },
              key,
            );
            await deviceUnlockStore.save(saved);
          } else {
            await deviceUnlockStore.forget(projectUrl);
          }
          setRememberedUnlock(rememberUnlock);
        } catch {
          if (rememberUnlock || rememberedUnlock) {
            setMessage(
              rememberUnlock
                ? "No se pudo recordar el desbloqueo en este dispositivo."
                : "No se pudo borrar el desbloqueo guardado en este dispositivo.",
            );
          }
        }
      }
      startSync(engine);
      form.reset();
    } catch (error) {
      onStatus("error");
      setMessage(syncConnectionMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function forgetUnlock() {
    setBusy(true);
    try {
      await deviceUnlockStore?.forget(projectUrl);
      setRememberedUnlock(false);
      setRetryRestore(false);
      if (!stopSync) onStatus("inactive");
      setMessage("El desbloqueo guardado se ha borrado.");
    } catch {
      setMessage(
        "No se pudo borrar el desbloqueo guardado en este dispositivo.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    stopSync?.();
    setStopSync(undefined);
    setRecovery("");
    setMessage("");
    setBusy(true);
    setRetryRestore(false);
    onStatus("inactive");
    try {
      try {
        await deviceUnlockStore?.forget(projectUrl);
        setRememberedUnlock(false);
      } finally {
        await api.auth.signOut({ scope: "local" });
        setAccount(undefined);
        setRememberLogin(false);
      }
      setMessage("Sesión cerrada. Sincronización pausada.");
    } catch (error) {
      onStatus("error");
      setMessage(syncConnectionMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function changeProject() {
    setBusy(true);
    try {
      try {
        await deviceUnlockStore?.forget(projectUrl);
      } finally {
        await api.auth.signOut({ scope: "local" });
        await api.auth.dispose();
        setClient(undefined);
        setRetryRestore(false);
        setMessage("");
        onStatus("inactive");
      }
    } catch (error) {
      onStatus("error");
      setMessage(syncConnectionMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Sincronización" className="min-w-0 text-sm">
      <h3 className="font-semibold">Sincronización</h3>
      {account && (
        <p className="mt-2 break-words text-muted">
          {account.email ? (
            <>
              Sesión iniciada como <strong>{account.email}</strong>.
            </>
          ) : (
            "Sesión iniciada."
          )}
        </p>
      )}
      {restoring ? (
        <p role="status" className="mt-2 text-muted">
          Comprobando la sesión…
        </p>
      ) : stopSync ? (
        <p role="status" className="mt-2 text-muted">
          {status === "error"
            ? "Sincronización interrumpida. Se volverá a intentar automáticamente."
            : status === "synced"
              ? "Sincronización al día."
              : "Conectando con la sincronización…"}
        </p>
      ) : (
        <form onSubmit={connect} className="mt-2 grid min-w-0 gap-2">
          {account ? (
            <p className="text-muted">
              Desbloquea el cifrado para reanudar la sincronización.
            </p>
          ) : (
            <>
              <label className="grid gap-1">
                Correo
                <input
                  className="field min-w-0"
                  name="email"
                  type="email"
                  autoComplete="username"
                  required
                />
              </label>
              <label className="grid gap-1">
                Contraseña de acceso
                <input
                  className="field min-w-0"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                />
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name="remember"
                  checked={rememberLogin}
                  onChange={(event) =>
                    setRememberLogin(event.currentTarget.checked)
                  }
                />
                Mantener sesión iniciada
              </label>
            </>
          )}
          <label className="grid gap-1">
            Método
            <select className="field" name="method">
              <option value="passphrase">Frase de cifrado</option>
              <option value="recovery">Clave de recuperación</option>
            </select>
          </label>
          <label className="grid gap-1">
            Frase o clave
            <input
              className="field min-w-0"
              name="secret"
              type="password"
              autoComplete="off"
              required
            />
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" name="initialize" />
            Configurar el primer dispositivo
          </label>
          {deviceUnlockStore && (account?.rememberSession ?? rememberLogin) && (
            <div className="grid gap-1">
              <label className="flex items-center gap-2">
                <input type="checkbox" name="rememberUnlock" />
                Recordar el desbloqueo en este dispositivo
              </label>
              <p className="text-muted">
                Actívalo solo en un perfil de confianza. Cualquiera que pueda
                abrir Organify en este perfil podrá reanudar la sincronización.
              </p>
            </div>
          )}
          <p className="text-muted">
            Guarda la frase y la clave de recuperación. Si pierdes ambas, no
            podrás recuperar tus datos cifrados.
          </p>
          <Button type="submit" disabled={busy}>
            {busy ? "Conectando…" : account ? "Desbloquear" : "Conectar"}
          </Button>
        </form>
      )}
      {retryRestore && !restoring && (
        <Button
          type="button"
          className="mt-2"
          disabled={busy}
          onClick={restoreAgain}
        >
          Reintentar la restauración
        </Button>
      )}
      {account && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          {rememberedUnlock && !restoring && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void forgetUnlock()}
            >
              Olvidar desbloqueo
            </Button>
          )}
          <Button
            type="button"
            className={`bg-red-700 text-white hover:bg-red-800 ${stopSync ? "" : "w-full"}`}
            disabled={busy || restoring}
            onClick={() => void disconnect()}
          >
            {stopSync ? "Desconectar" : "Cerrar sesión"}
          </Button>
        </div>
      )}
      {!installedClient && !account && !restoring && (
        <Button
          className="mt-2 bg-transparent text-foreground hover:bg-panel"
          type="button"
          disabled={busy}
          onClick={() => void changeProject()}
        >
          Cambiar configuración de Supabase
        </Button>
      )}
      {message && (
        <p role="status" className="mt-2 break-words">
          {message}
        </p>
      )}
      {recovery && (
        <label className="mt-2 grid gap-1">
          Copia la clave de recuperación
          <input
            className="field min-w-0"
            value={recovery}
            readOnly
            onFocus={(event) => event.target.select()}
          />
        </label>
      )}
    </section>
  );
}
