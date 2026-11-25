import { afterEach, expect, it, vi } from "vitest";
import {
  checkSyncProtocol,
  createSyncClient,
  supabaseAdapter,
  workspaceAdapter,
} from "../src";

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

it("enruta las operaciones compartidas con su espacio y su alta", async () => {
  const requests: unknown[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init: RequestInit) => {
    requests.push({
      function: new URL(input).pathname.split("/").at(-1),
      protocol: new Headers(init.headers).get("x-organify-sync-protocol"),
      body: JSON.parse(String(init.body)),
    });
    return Response.json([]);
  });
  const client = createSyncClient(
    "https://example.supabase.co",
    "sb_publishable_example",
  );
  const adapter = workspaceAdapter(client, "space", "membership");
  const change = { opId: "op", deviceId: "device", ciphertext: "sealed" };
  await adapter.push([change]);
  await expect(adapter.pull("51", 100)).resolves.toEqual([]);
  expect(requests).toEqual([
    {
      function: "organify_workspace_push",
      protocol: "1",
      body: { space: "space", membership: "membership", batch: [change] },
    },
    {
      function: "organify_workspace_pull",
      protocol: "1",
      body: {
        space: "space",
        membership: "membership",
        after_cursor: "51",
        page_size: 100,
      },
    },
  ]);
});
