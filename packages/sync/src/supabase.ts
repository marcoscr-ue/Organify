import {
  createClient,
  type SupabaseClient,
  type SupabaseClientOptions,
} from "@supabase/supabase-js";
import type { Entry, SyncAdapter } from "./engine";

export const SYNC_PROTOCOL = 1;

export function createSyncClient(
  url: string,
  publicKey: string,
  auth: SupabaseClientOptions<"public">["auth"] = { persistSession: false },
) {
  return createClient(url, publicKey, {
    auth,
  });
}

const protocolHeader = "x-organify-sync-protocol";

export async function checkSyncProtocol(client: SupabaseClient) {
  const { error } = await client
    .rpc("organify_check_sync_protocol")
    .setHeader(protocolHeader, String(SYNC_PROTOCOL));
  if (error) throw error;
}

export function isSyncProtocolError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "PT426"
  );
}

export function supabaseAdapter(
  client: SupabaseClient,
  userId: string,
): SyncAdapter {
  return {
    async push(changes) {
      const { error } = await client
        .rpc("organify_push", { batch: changes, expected_user: userId })
        .setHeader(protocolHeader, String(SYNC_PROTOCOL));
      if (error) throw error;
    },
    async pull(cursor, limit) {
      const { data, error } = await client
        .rpc("organify_pull", {
          after_cursor: cursor,
          page_size: limit,
          expected_user: userId,
        })
        .setHeader(protocolHeader, String(SYNC_PROTOCOL));
      if (error) throw error;
      return data as Entry[];
    },
    subscribe(wake) {
      const channel = client
        .channel("organify-changes:" + userId)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "changes",
            filter: "user_id=eq." + userId,
          },
          wake,
        )
        .subscribe();
      return () => {
        void client.removeChannel(channel);
      };
    },
  };
}

export function workspaceAdapter(
  client: SupabaseClient,
  space: string,
  membership: string,
): SyncAdapter {
  return {
    async push(batch) {
      const { error } = await client
        .rpc("organify_workspace_push", { space, membership, batch })
        .setHeader(protocolHeader, String(SYNC_PROTOCOL));
      if (error) throw error;
    },
    async pull(after_cursor, page_size) {
      const { data, error } = await client
        .rpc("organify_workspace_pull", {
          space,
          membership,
          after_cursor,
          page_size,
        })
        .setHeader(protocolHeader, String(SYNC_PROTOCOL));
      if (error) throw error;
      return data as Entry[];
    },
    subscribe: () => () => {},
  };
}
