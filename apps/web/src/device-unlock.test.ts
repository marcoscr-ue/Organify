import { expect, it, vi } from "vitest";
import { openDeviceUnlock, protectDeviceUnlock } from "./device-unlock";
import { createAccountClient, resumeSync } from "./sync-connection";

const context = {
  projectUrl: "https://example.supabase.co",
  userId: "account",
  envelopeId: "envelope",
};

it("recupera la clave de un registro clonado con una clave local no exportable", async () => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const saved = structuredClone(await protectDeviceUnlock(context, masterKey));

  expect(saved.deviceKey.extractable).toBe(false);
  expect(saved.ciphertext.byteLength).toBeGreaterThan(masterKey.byteLength);
  await expect(openDeviceUnlock(saved)).resolves.toEqual(masterKey);
});

it.each([
  { projectUrl: "https://other.supabase.co" },
  { userId: "other-account" },
  { envelopeId: "other-envelope" },
])("rechaza un registro reasignado a %j", async (change) => {
  const masterKey = crypto.getRandomValues(new Uint8Array(32));
  const saved = await protectDeviceUnlock(context, masterKey);

  await expect(openDeviceUnlock({ ...saved, ...change })).rejects.toThrow();
});

it("reanuda con la sesión y la envoltura correctas y rechaza una envoltura sustituida", async () => {
  const original = { v: 1, nonce: "nonce", ciphertext: "ciphertext" };
  let recovery = original;
  const jwt = `eyJhbGciOiJIUzI1NiJ9.${btoa("{}")}.signature`.replaceAll(
    "=",
    "",
  );
  vi.stubGlobal("fetch", async (input: string | URL) => {
    switch (new URL(input).pathname) {
      case "/auth/v1/token":
        return Response.json({
          access_token: jwt,
          refresh_token: "refresh-token",
          expires_in: 3600,
          user: { id: context.userId },
        });
      case "/auth/v1/user":
        return Response.json({ id: context.userId });
      case "/rest/v1/key_envelopes":
        return Response.json([{ envelope: { v: 1, recovery } }]);
      case "/rest/v1/rpc/organify_check_sync_protocol":
      case "/rest/v1/rpc/organify_pull":
        return Response.json([]);
      default:
        throw new Error(`Ruta inesperada: ${input}`);
    }
  });
  const { api } = createAccountClient({
    url: context.projectUrl,
    publicKey: "sb_publishable_example",
  });
  try {
    const { error } = await api.auth.signInWithPassword({
      email: "test@example.com",
      password: "example-password",
    });
    expect(error).toBeNull();
    const saved = await protectDeviceUnlock(
      {
        ...context,
        envelopeId: JSON.stringify([1, 1, original.nonce, original.ciphertext]),
      },
      crypto.getRandomValues(new Uint8Array(32)),
    );
    const store = {
      bind: vi.fn(async () => undefined),
      pending: async () => [],
      acknowledge: async () => undefined,
      cursor: async () => "0",
      apply: async () => undefined,
    };
    const { engine } = await resumeSync(api, store, saved);
    await expect(engine.sync()).resolves.toBeUndefined();
    expect(store.bind).toHaveBeenCalledExactlyOnceWith(context.userId);

    recovery = { ...original, ciphertext: "replacement" };
    await expect(resumeSync(api, store, saved)).rejects.toThrow(
      "La clave de sincronización cambió.",
    );
    expect(store.bind).toHaveBeenCalledTimes(1);
  } finally {
    await api.auth.dispose();
    vi.unstubAllGlobals();
  }
});
