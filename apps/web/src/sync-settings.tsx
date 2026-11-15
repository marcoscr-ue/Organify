import { useEffect, useState, type FormEvent } from "react";
import {
  createKeyEnvelope,
  createOpCodec,
  unlockKey,
  type KeyEnvelope,
} from "@organify/crypto";
import { createSyncClient, supabaseAdapter, SyncEngine } from "@organify/sync";
import type { TaskRepositories } from "@organify/storage";
import { Button } from "@/components/ui/button";

const url = import.meta.env.VITE_SUPABASE_URL;
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client = url && publicKey ? createSyncClient(url, publicKey) : undefined;

export function SyncSettings({ store }: { store: TaskRepositories["sync"] }) {
  const [stop, setStop] = useState<() => void>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [recovery, setRecovery] = useState("");
  useEffect(() => stop, [stop]);
  if (!client) return null;
  const api = client;

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const email = String(data.get("email"));
    const password = String(data.get("password"));
    const secret = String(data.get("secret"));
    const method =
      data.get("method") === "recovery" ? "recovery" : "passphrase";
    const initialize = data.get("initialize") === "on";
    if (
      method === "passphrase" &&
      (password === secret || secret.trim().length < 12)
    ) {
      setMessage(
        "Usa una frase de cifrado distinta de la contraseña y de al menos 12 caracteres.",
      );
      return;
    }

    setBusy(true);
    setMessage("");
    try {
      const { data: login, error: loginError } =
        await api.auth.signInWithPassword({ email, password });
      if (loginError) throw loginError;
      const userId = login.user.id;
      const { data: existing, error } = await api
        .from("key_envelopes")
        .select("envelope")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw error;

      let key: Uint8Array;
      if (existing) {
        key = await unlockKey(
          userId,
          existing.envelope as KeyEnvelope,
          secret,
          method,
        );
        await store.bind(userId);
      } else {
        if (!initialize || method === "recovery") {
          setMessage(
            "Esta cuenta aún no tiene clave. Marca la opción de primer dispositivo para crearla.",
          );
          return;
        }
        await store.bind(userId);
        const created = await createKeyEnvelope(userId, secret);
        const { error: saveError } = await api
          .from("key_envelopes")
          .insert({ user_id: userId, envelope: created.envelope });
        if (saveError) throw saveError;
        key = created.key;
        setRecovery(created.recoveryKey);
      }

      const engine = new SyncEngine(
        store,
        supabaseAdapter(api, userId),
        createOpCodec(userId, key),
      );
      const pause = engine.start(() =>
        setMessage(
          "Sincronización interrumpida. Se volverá a intentar automáticamente.",
        ),
      );
      setStop(() => pause);
      setMessage("Sincronización en segundo plano activada.");
      form.reset();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No se pudo iniciar la sincronización.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="min-w-0 text-sm">
      <summary className="cursor-pointer font-semibold">Sincronización</summary>
      {stop ? (
        <Button
          type="button"
          className="mt-2"
          onClick={() => {
            stop();
            setStop(undefined);
            setRecovery("");
            setMessage("Sincronización pausada.");
            void api.auth.signOut({ scope: "local" });
          }}
        >
          Desconectar
        </Button>
      ) : (
        <form onSubmit={connect} className="mt-2 grid min-w-0 gap-2">
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
          <label className="flex items-start gap-2">
            <input type="checkbox" name="initialize" />
            Configurar el primer dispositivo
          </label>
          <p className="text-muted">
            Guarda la frase y la clave de recuperación. Si pierdes ambas, no
            podrás recuperar tus datos cifrados.
          </p>
          <Button type="submit" disabled={busy}>
            {busy ? "Conectando…" : "Conectar"}
          </Button>
        </form>
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
    </details>
  );
}
