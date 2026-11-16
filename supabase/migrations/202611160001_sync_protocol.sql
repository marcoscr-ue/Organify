-- Clients before 0.4.0 omit the header and use protocol 1.
create function public.organify_check_sync_protocol()
returns void language plpgsql stable set search_path = '' as $$
declare
  protocol text := coalesce(
    nullif(current_setting('request.headers', true), '')::jsonb
      ->> 'x-organify-sync-protocol',
    '1'
  );
  minimum_protocol constant integer := 1;
  maximum_protocol constant integer := 1;
begin
  if protocol !~ '^[1-9][0-9]{0,8}$' then
    raise sqlstate 'PT426' using message = 'Organify sync protocol is unsupported';
  end if;
  if protocol::integer not between minimum_protocol and maximum_protocol then
    raise sqlstate 'PT426' using message = 'Organify sync protocol is unsupported';
  end if;
end;
$$;

revoke all on function public.organify_check_sync_protocol() from public, anon;
grant execute on function public.organify_check_sync_protocol() to authenticated;

create or replace function public.organify_push(batch jsonb, expected_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid();
begin
  if account is null or account is distinct from expected_user then raise exception 'Authentication required'; end if;
  perform public.organify_check_sync_protocol();
  if jsonb_array_length(batch) > 100 then raise exception 'Batch too large'; end if;
  -- Allocate sequence numbers in commit order for each account.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(account::text, 0));
  insert into public.changes (user_id, op_id, device_id, ciphertext)
  select account, (entry->>'opId')::uuid, entry->>'deviceId',
         pg_catalog.convert_to(entry->>'ciphertext', 'UTF8')
  from pg_catalog.jsonb_array_elements(batch) as entry
  on conflict (user_id, op_id) do nothing;
end;
$$;

create or replace function public.organify_pull(after_cursor text, page_size integer, expected_user uuid)
returns table ("cursor" text, "opId" text, "deviceId" text, ciphertext text)
language plpgsql stable security invoker set search_path = '' as $$
begin
  perform public.organify_check_sync_protocol();
  return query
  select c.seq::text, c.op_id::text, c.device_id, pg_catalog.convert_from(c.ciphertext, 'UTF8')
  from public.changes as c
  where c.user_id = expected_user and c.user_id = (select auth.uid())
    and c.seq > after_cursor::bigint
  order by c.seq
  limit least(greatest(page_size, 1), 100);
end;
$$;
