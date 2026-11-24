// Genera las claves VAPID y el secreto del cron para la función organify-push.
// Uso: node supabase/generate-push-keys.mjs > supabase/functions/.env
// Después: supabase secrets set --env-file supabase/functions/.env
// Añade ORGANIFY_VAPID_SUBJECT (mailto: o https) antes de subir el archivo.

const base64Url = (bytes) =>
  Buffer.from(bytes).toString("base64url").replace(/=+$/, "");

const pair = await crypto.subtle.generateKey(
  { name: "ECDSA", namedCurve: "P-256" },
  true,
  ["sign", "verify"],
);
const publicKey = new Uint8Array(
  await crypto.subtle.exportKey("raw", pair.publicKey),
);
const { d } = await crypto.subtle.exportKey("jwk", pair.privateKey);

console.log(`ORGANIFY_VAPID_PUBLIC_KEY=${base64Url(publicKey)}`);
console.log(`ORGANIFY_VAPID_PRIVATE_KEY=${d}`);
console.log(
  `ORGANIFY_PUSH_CRON_SECRET=${base64Url(crypto.getRandomValues(new Uint8Array(32)))}`,
);
console.log("ORGANIFY_VAPID_SUBJECT=mailto:");
