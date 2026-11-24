-- Programa el envío de avisos push cada minuto.
-- Ejecútalo en SQL Editor después de aplicar 202611240001_push_reminders.sql y
-- desplegar la función organify-push. No forma parte de migrations porque
-- contiene datos propios de cada proyecto.
--
-- Si las extensiones no se pueden crear desde aquí, actívalas en
-- Database → Extensions (pg_cron y pg_net) y vuelve a ejecutar el script.
--
-- Usa el secreto ORGANIFY_PUSH_CRON_SECRET, no la clave secreta del proyecto:
-- pg_net guarda las cabeceras en su cola mientras la petición está pendiente.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Sustituye los dos valores antes de ejecutar.
select vault.create_secret(
  'https://TU-PROYECTO.supabase.co/functions/v1/organify-push',
  'organify_push_url'
);
select vault.create_secret('VALOR_DE_ORGANIFY_PUSH_CRON_SECRET', 'organify_push_cron_secret');

select cron.schedule(
  'organify-push-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'organify_push_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-organify-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'organify_push_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  ) as request_id;
  $$
);

-- Para detenerlo: select cron.unschedule('organify-push-reminders');
