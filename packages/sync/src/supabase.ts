import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Entry, SyncAdapter } from "./engine";

export function createSyncClient(url: string, publicKey: string) {
  return createClient(url, publicKey, { auth: { persistSession: false } });
}

export function supabaseAdapter(
  client: SupabaseClient,
  userId: string,
): SyncAdapter {
  return {
    async push(changes) {
      const { error } = await client.rpc("organify_push", {
        batch: changes,
        expected_user: userId,
      });
      if (error) throw error;
    },
    async pull(cursor, limit) {
      const { data, error } = await client.rpc("organify_pull", {
        after_cursor: cursor,
        page_size: limit,
        expected_user: userId,
      });
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
