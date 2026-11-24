// Envía los recordatorios push vencidos. Despliegue sin verificación de JWT:
//   supabase functions deploy organify-push --no-verify-jwt
// GET devuelve la clave pública VAPID para que la PWA se suscriba.
// POST lo invoca pg_cron cada minuto con la cabecera x-organify-cron-secret.

import { createPushRequest, type VapidKeys } from "../_shared/web-push.ts";

interface DueReminder {
  id: number;
  reminder_id: string;
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function env(name: string) {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Falta la variable ${name}.`);
  return value;
}

function vapidKeys(): VapidKeys {
  return {
    publicKey: env("ORGANIFY_VAPID_PUBLIC_KEY"),
    privateKey: env("ORGANIFY_VAPID_PRIVATE_KEY"),
    subject: env("ORGANIFY_VAPID_SUBJECT"),
  };
}

function serviceKey() {
  const keys = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (keys) {
    const parsed = JSON.parse(keys) as Record<string, string>;
    if (parsed.default) return parsed.default;
  }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}

async function rpc<T>(name: string, args: Record<string, unknown>) {
  const key = serviceKey();
  const headers: Record<string, string> = {
    apikey: key,
    "Content-Type": "application/json",
  };
  // Las claves heredadas son JWT; las sb_secret_ viajan solo en apikey.
  if (!key.startsWith("sb_")) headers.Authorization = `Bearer ${key}`;
  const response = await fetch(`${env("SUPABASE_URL")}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(args),
  });
  if (!response.ok)
    throw new Error(`${name}: ${response.status} ${await response.text()}`);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

function sameSecret(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index++)
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  return difference === 0;
}

type Outcome = "sent" | "gone" | "retry" | "drop";

async function deliver(reminder: DueReminder, vapid: VapidKeys) {
  let request: Request;
  try {
    request = await createPushRequest(
      {
        endpoint: reminder.endpoint,
        p256dh: reminder.p256dh,
        auth: reminder.auth_secret,
      },
      { v: 1, reminder: reminder.reminder_id },
      vapid,
    );
  } catch (error) {
    console.error("Suscripción no válida", reminder.subscription_id, error);
    return "gone" satisfies Outcome;
  }
  try {
    const response = await fetch(request);
    await response.body?.cancel();
    if (response.ok) return "sent" satisfies Outcome;
    if (response.status === 404 || response.status === 410)
      return "gone" satisfies Outcome;
    if (response.status === 429 || response.status >= 500)
      return "retry" satisfies Outcome;
    console.error("Servicio push rechazó el aviso", response.status);
    return "drop" satisfies Outcome;
  } catch (error) {
    console.error("No se pudo contactar con el servicio push", error);
    return "retry" satisfies Outcome;
  }
}

async function sendDue() {
  const vapid = vapidKeys();
  let total = 0;
  // Varias rondas por invocación, con un límite para no superar el tiempo máximo.
  for (let round = 0; round < 10; round++) {
    const due = await rpc<DueReminder[]>("organify_push_claim", {
      batch_size: 100,
    });
    if (!due.length) break;
    const outcomes = await Promise.all(
      due.map((reminder) => deliver(reminder, vapid)),
    );
    const sent: number[] = [];
    const gone = new Set<string>();
    outcomes.forEach((outcome, index) => {
      if (outcome === "sent" || outcome === "drop") sent.push(due[index].id);
      if (outcome === "gone") gone.add(due[index].subscription_id);
    });
    await rpc("organify_push_complete", { sent, gone: [...gone] });
    total += due.length;
    if (due.length < 100) break;
  }
  return total;
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });
  try {
    if (request.method === "GET") {
      return Response.json(
        { publicKey: env("ORGANIFY_VAPID_PUBLIC_KEY") },
        { headers: { ...cors, "Cache-Control": "max-age=300" } },
      );
    }
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405, headers: cors });
    const secret = request.headers.get("x-organify-cron-secret") ?? "";
    if (!sameSecret(secret, env("ORGANIFY_PUSH_CRON_SECRET")))
      return new Response("Unauthorized", { status: 401 });
    return Response.json({ processed: await sendDue() });
  } catch (error) {
    console.error(error);
    return new Response("Internal error", { status: 500, headers: cors });
  }
});
