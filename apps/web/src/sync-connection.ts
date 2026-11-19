import { isSyncProtocolError } from "@organify/sync";

export interface SyncProject {
  url: string;
  publicKey: string;
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
