import { describe, expect, it } from "vitest";
import { readSyncProject, syncConnectionMessage } from "./sync-connection";

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
