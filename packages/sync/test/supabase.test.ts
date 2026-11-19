import { afterEach, expect, it, vi } from "vitest";
import { checkSyncProtocol, createSyncClient, supabaseAdapter } from "../src";

afterEach(() => vi.unstubAllGlobals());

it("envía la cabecera del protocolo únicamente en las RPC de sincronización", async () => {
  const requests = new Map<string, string | null>();
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
    const path = new URL(input).pathname;
    requests.set(
      path,
      new Headers(init.headers).get("x-organify-sync-protocol"),
    );
    if (path === "/auth/v1/token") {
      return Response.json(
        { error_code: "invalid_credentials" },
        { status: 400 },
      );
    }
    return Response.json([]);
  });
  const client = createSyncClient(
    "https://example.supabase.co",
    "sb_publishable_example",
  );
  const { error } = await client.auth.signInWithPassword({
    email: "test@example.com",
    password: "example-password",
  });
  expect(error?.code).toBe("invalid_credentials");
  await checkSyncProtocol(client);
  const adapter = supabaseAdapter(client, "user");
  await adapter.push([]);
  await expect(adapter.pull("0", 100)).resolves.toEqual([]);
  expect(Object.fromEntries(requests)).toEqual({
    "/auth/v1/token": null,
    "/rest/v1/rpc/organify_check_sync_protocol": "1",
    "/rest/v1/rpc/organify_push": "1",
    "/rest/v1/rpc/organify_pull": "1",
  });
});
