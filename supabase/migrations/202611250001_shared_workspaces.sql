create table public.organify_workspaces (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  encrypted_name jsonb not null
);

create table public.organify_workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.organify_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  key_box jsonb not null,
  unique (workspace_id, user_id)
);
create index organify_workspace_members_user on public.organify_workspace_members (user_id);

create table public.organify_workspace_invites (
  id uuid primary key,
  workspace_id uuid not null references public.organify_workspaces(id) on delete cascade,
  recipient text not null,
  proof text not null,
  key_box jsonb not null,
  expires_at timestamptz not null default now() + interval '48 hours',
  unique (workspace_id, recipient)
);

create table public.organify_workspace_changes (
  seq bigint generated always as identity primary key,
  workspace_id uuid not null references public.organify_workspaces(id) on delete cascade,
  op_id uuid not null,
  device_id text not null,
  ciphertext text not null,
  unique (workspace_id, op_id)
);
create index organify_workspace_changes_cursor on public.organify_workspace_changes (workspace_id, seq);

alter table public.organify_workspaces enable row level security;
alter table public.organify_workspace_members enable row level security;
alter table public.organify_workspace_invites enable row level security;
alter table public.organify_workspace_changes enable row level security;
revoke all on public.organify_workspaces, public.organify_workspace_members,
  public.organify_workspace_invites, public.organify_workspace_changes from public, anon, authenticated;

create function public.organify_workspace_list()
returns table (id uuid, membership_id uuid, is_owner boolean, encrypted_name jsonb, key_box jsonb)
language sql stable security definer set search_path = '' as $$
  select w.id, m.id, w.owner_id = m.user_id, w.encrypted_name, m.key_box
  from public.organify_workspace_members m
  join public.organify_workspaces w on w.id = m.workspace_id
  where m.user_id = (select auth.uid())
  order by w.id;
$$;

create function public.organify_workspace_create(space uuid, expected_user uuid, name_box jsonb, own_key_box jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare account uuid := auth.uid();
begin
  if account is null or account is distinct from expected_user then raise sqlstate '42501'; end if;
  insert into public.organify_workspaces (id, owner_id, encrypted_name)
  values (space, account, name_box);
  insert into public.organify_workspace_members (workspace_id, user_id, key_box)
  values (space, account, own_key_box);
end;
$$;

create function public.organify_workspace_invite(space uuid, invite uuid, email text, invite_proof text, invite_box jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace:' || space::text, 0));
  if not exists (
    select 1 from public.organify_workspaces where id = space and owner_id = auth.uid()
  ) then raise sqlstate '42501'; end if;
  if invite_proof !~ '^[0-9a-f]{64}$' or length(trim(email)) not between 3 and 254
    then raise sqlstate '22023'; end if;
  insert into public.organify_workspace_invites (id, workspace_id, recipient, proof, key_box)
  values (invite, space, lower(trim(email)), invite_proof, invite_box)
  on conflict (workspace_id, recipient) do update set
    id = excluded.id, proof = excluded.proof, key_box = excluded.key_box,
    expires_at = excluded.expires_at;
end;
$$;

create function public.organify_workspace_read_invite(invite uuid, invite_proof text)
returns table (workspace_id uuid, key_box jsonb)
language sql stable security definer set search_path = '' as $$
  select i.workspace_id, i.key_box
  from public.organify_workspace_invites i
  join auth.users u on u.id = (select auth.uid())
  where i.id = invite and i.proof = invite_proof and i.expires_at > now()
    and i.recipient = lower(u.email) and u.email_confirmed_at is not null;
$$;

create function public.organify_workspace_accept(space uuid, invite uuid, invite_proof text, expected_user uuid, own_key_box jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare account uuid := auth.uid();
begin
  if account is null or account is distinct from expected_user then raise sqlstate '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace:' || space::text, 0));
  delete from public.organify_workspace_invites i using auth.users u
  where i.id = invite and i.workspace_id = space and i.proof = invite_proof
    and i.expires_at > now() and u.id = account and u.email_confirmed_at is not null
    and i.recipient = lower(u.email);
  if not found then raise sqlstate '42501'; end if;
  insert into public.organify_workspace_members (workspace_id, user_id, key_box)
  values (space, account, own_key_box)
  on conflict (workspace_id, user_id) do nothing;
end;
$$;

create function public.organify_workspace_members_list(space uuid)
returns table (membership_id uuid, email text)
language sql stable security definer set search_path = '' as $$
  select m.id, u.email::text
  from public.organify_workspaces w
  join public.organify_workspace_members m on m.workspace_id = w.id and m.user_id <> w.owner_id
  join auth.users u on u.id = m.user_id
  where w.id = space and w.owner_id = (select auth.uid())
  order by u.email;
$$;

create function public.organify_workspace_remove_member(space uuid, membership uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare recipient_email text;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace:' || space::text, 0));
  delete from public.organify_workspace_members m using public.organify_workspaces w, auth.users u
  where w.id = space and w.owner_id = auth.uid() and m.workspace_id = w.id
    and m.id = membership and m.user_id <> w.owner_id and u.id = m.user_id
  returning lower(u.email) into recipient_email;
  if not found then raise sqlstate '42501'; end if;
  delete from public.organify_workspace_invites i
  where i.workspace_id = space and i.recipient = recipient_email;
end;
$$;

create function public.organify_workspace_push(space uuid, membership uuid, batch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public.organify_check_sync_protocol();
  if jsonb_typeof(batch) is distinct from 'array' or jsonb_array_length(batch) > 100
    then raise sqlstate '22023'; end if;
  -- Allocate cursors in commit order and serialize writes with removal.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('workspace:' || space::text, 0));
  if not exists (
    select 1 from public.organify_workspace_members
    where id = membership and workspace_id = space and user_id = auth.uid()
  ) then raise sqlstate '42501'; end if;
  insert into public.organify_workspace_changes (workspace_id, op_id, device_id, ciphertext)
  select space, (entry->>'opId')::uuid, entry->>'deviceId', entry->>'ciphertext'
  from pg_catalog.jsonb_array_elements(batch) as entry
  on conflict (workspace_id, op_id) do nothing;
end;
$$;

create function public.organify_workspace_pull(space uuid, membership uuid, after_cursor text, page_size integer)
returns table ("cursor" text, "opId" text, "deviceId" text, ciphertext text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.organify_check_sync_protocol();
  if not exists (
    select 1 from public.organify_workspace_members
    where id = membership and workspace_id = space and user_id = auth.uid()
  ) then raise sqlstate '42501'; end if;
  return query
  select c.seq::text, c.op_id::text, c.device_id, c.ciphertext
  from public.organify_workspace_changes c
  where c.workspace_id = space and c.seq > after_cursor::bigint
  order by c.seq
  limit least(greatest(page_size, 1), 100);
end;
$$;

revoke all on function public.organify_workspace_list(),
  public.organify_workspace_create(uuid, uuid, jsonb, jsonb),
  public.organify_workspace_invite(uuid, uuid, text, text, jsonb),
  public.organify_workspace_read_invite(uuid, text),
  public.organify_workspace_accept(uuid, uuid, text, uuid, jsonb),
  public.organify_workspace_members_list(uuid),
  public.organify_workspace_remove_member(uuid, uuid),
  public.organify_workspace_push(uuid, uuid, jsonb),
  public.organify_workspace_pull(uuid, uuid, text, integer)
from public, anon, authenticated;

grant execute on function public.organify_workspace_list(),
  public.organify_workspace_create(uuid, uuid, jsonb, jsonb),
  public.organify_workspace_invite(uuid, uuid, text, text, jsonb),
  public.organify_workspace_read_invite(uuid, text),
  public.organify_workspace_accept(uuid, uuid, text, uuid, jsonb),
  public.organify_workspace_members_list(uuid),
  public.organify_workspace_remove_member(uuid, uuid),
  public.organify_workspace_push(uuid, uuid, jsonb),
  public.organify_workspace_pull(uuid, uuid, text, integer)
to authenticated;
