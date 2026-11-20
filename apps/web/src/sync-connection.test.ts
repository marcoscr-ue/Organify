import { describe, expect, it, vi } from "vitest";
import {
  createAccountClient,
  readSyncProject,
  syncConnectionMessage,
} from "./sync-connection";

const url = "https://example.supabase.co";
const publishableKey = "sb_publishable_example";
const jwtWithRole = (role: string) =>
  `eyJhbGciOiJIUzI1NiJ9.${btoa(JSON.stringify({ role })).replace(/=+$/, "")}.signature`;

describe("configuración de Supabase", () => {
  it("normaliza la URL y acepta tanto la clave pública actual como anon", () => {
    expect(readSyncProject(` ${url}/ `, ` ${publishableKey} `)).toEqual({
      url,
      publicKey: publishableKey,
    });
    const anonKey = jwtWithRole("anon");
    expect(readSyncProject(url, anonKey).publicKey).toBe(anonKey);
  });

  it("rechaza claves privadas y URLs que no son la base del proyecto", () => {
    expect(() => readSyncProject(url, "sb_secret_example")).toThrow(
      "clave pública",
    );
    expect(() => readSyncProject(url, jwtWithRole("service_role"))).toThrow(
      "clave pública",
    );
    expect(() => readSyncProject(`${url}/rest/v1`, publishableKey)).toThrow(
      "URL del proyecto",
    );
    expect(() =>
      readSyncProject("http://example.supabase.co", publishableKey),
    ).toThrow("URL del proyecto");
    expect(readSyncProject("http://127.0.0.1:54321", publishableKey).url).toBe(
      "http://127.0.0.1:54321",
    );
  });
});

it.each([
  [{ name: "AuthRetryableFetchError" }, "contactar con Supabase"],
  [{ code: "invalid_credentials" }, "rechazó el correo o la contraseña"],
  [{ status: 401 }, "URL y la clave pública"],
  [{ code: "PGRST202" }, "migraciones de Organify"],
  [{ code: "PT426" }, "Actualiza Organify"],
])("explica el error de conexión %j", (error, message) => {
  expect(syncConnectionMessage(error)).toContain(message);
});

it.each([false, true])(
  "restaura la sesión según la opción de recordarla (%s)",
  async (remember) => {
    const saved = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => saved.set(key, value),
      removeItem: (key: string) => saved.delete(key),
    });
    vi.stubGlobal("fetch", async (input: string | URL) => {
      const path = new URL(input).pathname;
      if (path === "/auth/v1/logout")
        return new Response(null, { status: 204 });
      if (path !== "/auth/v1/token")
        throw new Error(`Ruta inesperada: ${path}`);
      return Response.json({
        access_token: jwtWithRole("authenticated"),
        refresh_token: "refresh-token",
        expires_in: 3600,
        user: { id: "user", email: "test@example.com" },
      });
    });
    try {
      const project = readSyncProject(url, publishableKey);
      const { api, setRememberSession } = createAccountClient(project);
      await api.auth.getSession();
      setRememberSession(remember);
      const { error } = await api.auth.signInWithPassword({
        email: "test@example.com",
        password: "example-password",
      });
      expect(error).toBeNull();
      expect((await api.auth.getSession()).data.session?.user.id).toBe("user");
      expect(saved.size).toBe(remember ? 1 : 0);

      const reopened = createAccountClient(project).api;
      const { data } = await reopened.auth.getSession();
      expect(data.session?.user.id).toBe(remember ? "user" : undefined);

      expect((await api.auth.signOut({ scope: "local" })).error).toBeNull();
      expect(saved.size).toBe(0);
      expect((await reopened.auth.getSession()).data.session).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  },
);
