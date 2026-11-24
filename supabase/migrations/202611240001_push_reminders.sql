-- Avisos push de la PWA. Independiente del protocolo de sincronización.
-- El servidor solo conoce la suscripción push del navegador y la hora de cada
-- recordatorio, identificado con un UUID aleatorio sin relación con la tarea.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (endpoint ~ '^https://' and length(endpoint) <= 2048),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth_secret text not null check (auth_secret ~ '^[A-Za-z0-9_-]{22}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, endpoint)
);

create table public.push_reminders (
  id bigint generated always as identity primary key,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  reminder_id uuid not null,
  fire_at timestamptz not null,
  claimed_until timestamptz,
  unique (subscription_id, reminder_id)
);

create index push_reminders_due on public.push_reminders (fire_at);

alter table public.push_subscriptions enable row level security;
alter table public.push_reminders enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
revoke all on public.push_reminders from public, anon, authenticated;

-- Registra o renueva la suscripción de este navegador y devuelve su id.
create function public.organify_push_register(endpoint text, p256dh text, auth_secret text)
returns uuid language plpgsql security definer set search_path = '' as $$
#variable_conflict use_column
declare
  account uuid := auth.uid();
  subscription uuid;
begin
  if account is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.push_subscriptions as s
    where s.user_id = account and s.endpoint = organify_push_register.endpoint
  ) and (
    select count(*) from public.push_subscriptions as s where s.user_id = account
  ) >= 20 then
    raise exception 'Too many push subscriptions';
  end if;
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth_secret)
  values (account, organify_push_register.endpoint, organify_push_register.p256dh,
          organify_push_register.auth_secret)
  on conflict (user_id, endpoint) do update
    set p256dh = excluded.p256dh, auth_secret = excluded.auth_secret, updated_at = now()
  returning s.id into subscription;
  return subscription;
end;
$$;

-- Sustituye la lista completa de recordatorios de una suscripción.
-- reminders: [{"id": "<uuid>", "at": "<ISO 8601>"}]
create function public.organify_push_replace(subscription uuid, reminders jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  account uuid := auth.uid();
begin
  if account is null then raise exception 'Authentication required'; end if;
  if not exists (
    select 1 from public.push_subscriptions as s
    where s.id = subscription and s.user_id = account
  ) then
    raise sqlstate 'P0002' using message = 'Push subscription not found';
  end if;
  if jsonb_typeof(reminders) is distinct from 'array' or jsonb_array_length(reminders) > 500 then
    raise exception 'Invalid reminders';
  end if;

  delete from public.push_reminders as r
  where r.subscription_id = subscription
    and r.reminder_id not in (
      select (entry->>'id')::uuid from pg_catalog.jsonb_array_elements(reminders) as entry
    );

  insert into public.push_reminders (subscription_id, reminder_id, fire_at)
  select subscription, (entry->>'id')::uuid, (entry->>'at')::timestamptz
  from pg_catalog.jsonb_array_elements(reminders) as entry
  on conflict (subscription_id, reminder_id) do update
    set fire_at = excluded.fire_at, claimed_until = null
    where public.push_reminders.fire_at is distinct from excluded.fire_at;
end;
$$;

-- Borra la suscripción de este navegador y sus recordatorios.
create function public.organify_push_unregister(endpoint text)
returns void language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions as s
  where s.user_id = (select auth.uid()) and s.endpoint = organify_push_unregister.endpoint;
$$;

-- Solo para la Edge Function: reserva los avisos vencidos durante dos minutos.
-- Los avisos con más de 12 horas de retraso se descartan.
create function public.organify_push_claim(batch_size integer)
returns table (id bigint, reminder_id uuid, subscription_id uuid, endpoint text, p256dh text, auth_secret text)
language sql security definer set search_path = '' as $$
  delete from public.push_reminders as r where r.fire_at < now() - interval '12 hours';
  with due as (
    select r.id from public.push_reminders as r
    where r.fire_at <= now() and (r.claimed_until is null or r.claimed_until < now())
    order by r.fire_at
    limit least(greatest(batch_size, 1), 500)
    for update skip locked
  )
  update public.push_reminders as r
  set claimed_until = now() + interval '2 minutes'
  from due, public.push_subscriptions as s
  where r.id = due.id and s.id = r.subscription_id
  returning r.id, r.reminder_id, r.subscription_id, s.endpoint, s.p256dh, s.auth_secret;
$$;

-- Solo para la Edge Function: confirma los envíos y retira suscripciones caducadas.
create function public.organify_push_complete(sent bigint[], gone uuid[])
returns void language sql security definer set search_path = '' as $$
  delete from public.push_reminders as r where r.id = any(sent);
  delete from public.push_subscriptions as s where s.id = any(gone);
$$;

revoke all on function public.organify_push_register(text, text, text) from public, anon;
revoke all on function public.organify_push_replace(uuid, jsonb) from public, anon;
revoke all on function public.organify_push_unregister(text) from public, anon;
revoke all on function public.organify_push_claim(integer) from public, anon, authenticated;
revoke all on function public.organify_push_complete(bigint[], uuid[]) from public, anon, authenticated;
grant execute on function public.organify_push_register(text, text, text) to authenticated;
grant execute on function public.organify_push_replace(uuid, jsonb) to authenticated;
grant execute on function public.organify_push_unregister(text) to authenticated;
grant execute on function public.organify_push_claim(integer) to service_role;
grant execute on function public.organify_push_complete(bigint[], uuid[]) to service_role;
