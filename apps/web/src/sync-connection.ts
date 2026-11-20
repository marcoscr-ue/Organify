import {
  createKeyEnvelope,
  createOpCodec,
  unlockKey,
  type KeyEnvelope,
} from "@organify/crypto";
import {
  checkSyncProtocol,
  createSyncClient,
  isSyncProtocolError,
  supabaseAdapter,
  SyncEngine,
} from "@organify/sync";
import type { SavedDeviceUnlock, TaskRepositories } from "@organify/storage";
import { openDeviceUnlock } from "./device-unlock";

export interface SyncProject {
  url: string;
  publicKey: string;
}

export function createAccountClient(project: SyncProject) {
  const storageKey = `organify:sync-session:${project.url}`;
  const memory = new Map<string, string>();
  let persistentStorage: Storage | undefined;
  try {
    persistentStorage = localStorage;
    persistentStorage.getItem(storageKey);
  } catch {
    persistentStorage = undefined;
  }
  let rememberSession = Boolean(persistentStorage);
  const api = createSyncClient(project.url, project.publicKey, {
    detectSessionInUrl: false,
    persistSession: true,
    storageKey,
    storage: {
      getItem(key) {
        return rememberSession
          ? (persistentStorage?.getItem(key) ?? null)
          : (memory.get(key) ?? null);
      },
      setItem(key, value) {
        if (rememberSession) persistentStorage?.setItem(key, value);
        else memory.set(key, value);
      },
      removeItem(key) {
        if (rememberSession) persistentStorage?.removeItem(key);
        else memory.delete(key);
      },
    },
  });
  return {
    api,
    projectUrl: project.url,
    setRememberSession(remember: boolean) {
      if (remember && !persistentStorage) {
        throw new Error("Este dispositivo no permite guardar la sesión.");
      }
      if (!remember) persistentStorage?.removeItem(storageKey);
      rememberSession = remember;
    },
  };
}

type SyncClient = ReturnType<typeof createSyncClient>;

async function readKeyEnvelope(api: SyncClient, userId: string) {
  await checkSyncProtocol(api);
  const { data, error } = await api
    .from("key_envelopes")
    .select("envelope")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data ? (data.envelope as KeyEnvelope) : undefined;
}

function envelopeId(envelope: KeyEnvelope) {
  return JSON.stringify([
    envelope.v,
    envelope.recovery.v,
    envelope.recovery.nonce,
    envelope.recovery.ciphertext,
  ]);
}

function createEngine(
  api: SyncClient,
  store: TaskRepositories["sync"],
  userId: string,
  key: Uint8Array,
) {
  return new SyncEngine(
    store,
    supabaseAdapter(api, userId),
    createOpCodec(userId, key),
  );
}

export async function resumeSync(
  api: SyncClient,
  store: TaskRepositories["sync"],
  saved: SavedDeviceUnlock,
) {
  const { data, error } = await api.auth.getUser();
  if (error) throw error;
  if (data.user.id !== saved.userId) {
    throw new Error("El desbloqueo guardado pertenece a otra cuenta.");
  }
  const envelope = await readKeyEnvelope(api, saved.userId);
  if (!envelope || envelopeId(envelope) !== saved.envelopeId) {
    throw new Error("La clave de sincronización cambió.");
  }
  const key = await openDeviceUnlock(saved);
  await store.bind(saved.userId);
  return createEngine(api, store, saved.userId, key);
}

export async function unlockSync(
  api: SyncClient,
  store: TaskRepositories["sync"],
  userId: string,
  secret: string,
  method: "passphrase" | "recovery",
  initialize: boolean,
) {
  let envelope = await readKeyEnvelope(api, userId);
  let key: Uint8Array;
  let recoveryKey = "";
  if (envelope) {
    key = await unlockKey(userId, envelope, secret, method);
    await store.bind(userId);
  } else {
    if (!initialize || method === "recovery") {
      throw new Error(
        "Esta cuenta aún no tiene clave. Marca la opción de primer dispositivo para crearla.",
      );
    }
    await store.bind(userId);
    const created = await createKeyEnvelope(userId, secret);
    const { error: saveError } = await api
      .from("key_envelopes")
      .insert({ user_id: userId, envelope: created.envelope });
    if (saveError) throw saveError;
    key = created.key;
    envelope = created.envelope;
    recoveryKey = created.recoveryKey;
  }

  return {
    engine: createEngine(api, store, userId, key),
    key,
    envelopeId: envelopeId(envelope),
    recoveryKey,
  };
}

export function readSyncProject(url: string, key: string): SyncProject {
  const urlMessage =
    "Introduce la URL del proyecto de Supabase, sin rutas como /rest/v1.";
  let projectUrl: URL;
  try {
    projectUrl = new URL(url.trim());
  } catch {
    throw new Error(urlMessage);
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(
    projectUrl.hostname,
  );
  if (
    (projectUrl.protocol !== "https:" &&
      !(local && projectUrl.protocol === "http:")) ||
    projectUrl.username ||
    projectUrl.password ||
    projectUrl.pathname !== "/" ||
    projectUrl.search ||
    projectUrl.hash
  ) {
    throw new Error(urlMessage);
  }

  const publicKey = key.trim();
  if (!/^sb_publishable_[\w-]+$/.test(publicKey) && !isAnonKey(publicKey)) {
    throw new Error(
      "Introduce la clave pública del proyecto de Supabase (sb_publishable_… o anon).",
    );
  }

  return { url: projectUrl.origin, publicKey };
}

function isAnonKey(key: string) {
  if (!/^[\w-]+\.[\w-]+\.[\w-]+$/.test(key)) return false;
  try {
    const payload = key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(payload))?.role === "anon";
  } catch {
    return false;
  }
}

export const protocolMessage =
  "Esta versión no es compatible con la sincronización. Actualiza Organify e inténtalo de nuevo. Puedes seguir trabajando en local.";

export function syncConnectionMessage(error: unknown) {
  if (isSyncProtocolError(error)) return protocolMessage;
  if (typeof error === "object" && error !== null) {
    const code = "code" in error ? error.code : undefined;
    if (code === "invalid_credentials") {
      return "Supabase rechazó el correo o la contraseña. Comprueba que el usuario existe en el proyecto configurado.";
    }
    if (code === "email_not_confirmed") {
      return "Confirma el correo de la cuenta de Supabase antes de conectar.";
    }
    if (code === "PGRST202" || code === "PGRST205" || code === "42P01") {
      return "Falta la configuración de sincronización en Supabase. Comprueba que se hayan aplicado en orden las migraciones de Organify.";
    }
    if ("status" in error && error.status === 401) {
      return "Supabase rechazó el acceso. Comprueba que la URL y la clave pública correspondan al mismo proyecto.";
    }
    if (
      ("name" in error && error.name === "AuthRetryableFetchError") ||
      code === ""
    ) {
      return "No se pudo contactar con Supabase. Comprueba la conexión a Internet, la URL del proyecto y que esté activo.";
    }
  }
  return error instanceof Error
    ? error.message
    : "No se pudo iniciar la sincronización. Comprueba la configuración de Supabase.";
}
