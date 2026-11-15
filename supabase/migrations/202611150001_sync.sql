create table public.changes (
  seq bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  op_id uuid not null,
  device_id text not null,
  ciphertext bytea not null,
  created_at timestamptz not null default now(),
  unique (user_id, op_id)
);

create index changes_user_seq on public.changes (user_id, seq);
alter table public.changes enable row level security;
revoke all on public.changes from public, anon, authenticated;
grant select on public.changes to authenticated;
create policy "Read own changes" on public.changes for select to authenticated
  using (user_id = (select auth.uid()));

create table public.key_envelopes (
  user_id uuid primary key references auth.users(id) on delete cascade,
  envelope jsonb not null
);
alter table public.key_envelopes enable row level security;
revoke all on public.key_envelopes from public, anon, authenticated;
grant select, insert on public.key_envelopes to authenticated;
create policy "Read own envelope" on public.key_envelopes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "Create own envelope" on public.key_envelopes for insert to authenticated
  with check (user_id = (select auth.uid()));

create function public.organify_push(batch jsonb, expected_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid();
begin
  if account is null or account is distinct from expected_user then raise exception 'Authentication required'; end if;
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

create function public.organify_pull(after_cursor text, page_size integer, expected_user uuid)
returns table ("cursor" text, "opId" text, "deviceId" text, ciphertext text)
language sql stable security invoker set search_path = '' as $$
  select c.seq::text, c.op_id::text, c.device_id, pg_catalog.convert_from(c.ciphertext, 'UTF8')
  from public.changes as c
  where c.user_id = expected_user and c.user_id = (select auth.uid())
    and c.seq > after_cursor::bigint
  order by c.seq
  limit least(greatest(page_size, 1), 100);
$$;

revoke all on function public.organify_push(jsonb, uuid) from public, anon;
revoke all on function public.organify_pull(text, integer, uuid) from public, anon;
grant execute on function public.organify_push(jsonb, uuid) to authenticated;
grant execute on function public.organify_pull(text, integer, uuid) to authenticated;
alter publication supabase_realtime add table public.changes;
