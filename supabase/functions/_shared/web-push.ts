// Web Push sin dependencias: cifrado aes128gcm (RFC 8291) y VAPID (RFC 8292).
// Solo usa Web Crypto, así que funciona igual en Deno (Edge Functions) y Node.

type Bytes = Uint8Array<ArrayBuffer>;

const encoder = new TextEncoder();

export function encodeBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function decodeBase64Url(value: string): Bytes {
  if (!/^[A-Za-z0-9_-]*$/.test(value)) throw new Error("Base64url no válido.");
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function concat(...parts: Uint8Array[]): Bytes {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function publicPoint(publicKey: Uint8Array) {
  if (publicKey.length !== 65 || publicKey[0] !== 4)
    throw new Error("La clave pública P-256 debe estar sin comprimir.");
  return {
    x: encodeBase64Url(publicKey.subarray(1, 33)),
    y: encodeBase64Url(publicKey.subarray(33, 65)),
  };
}

function importPrivateKey(
  privateKey: Uint8Array,
  publicKey: Uint8Array,
  algorithm: "ECDH" | "ECDSA",
) {
  if (privateKey.length !== 32)
    throw new Error("La clave privada P-256 debe tener 32 bytes.");
  return crypto.subtle.importKey(
    "jwk",
    {
      kty: "EC",
      crv: "P-256",
      d: encodeBase64Url(privateKey),
      ...publicPoint(publicKey),
      ext: true,
    },
    { name: algorithm, namedCurve: "P-256" },
    false,
    algorithm === "ECDH" ? ["deriveBits"] : ["sign"],
  );
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      key,
      length * 8,
    ),
  );
}

export interface PushSubscriptionKeys {
  /** Clave pública del navegador (p256dh), base64url. */
  p256dh: string;
  /** Secreto de autenticación del navegador, base64url. */
  auth: string;
}

export interface EncryptOptions {
  /** Solo para pruebas: sal fija de 16 bytes. */
  salt?: Bytes;
  /** Solo para pruebas: par de claves del servidor fijo. */
  senderKeys?: { publicKey: Bytes; privateKey: Bytes };
}

const recordSize = 4096;

/** Cifra un mensaje con el esquema aes128gcm en un único registro. */
export async function encryptPayload(
  keys: PushSubscriptionKeys,
  payload: Uint8Array,
  options: EncryptOptions = {},
): Promise<Bytes> {
  const receiverPublic = decodeBase64Url(keys.p256dh);
  const authSecret = decodeBase64Url(keys.auth);
  if (authSecret.length !== 16)
    throw new Error("El secreto de la suscripción debe tener 16 bytes.");
  // Un registro admite el texto, el delimitador y la etiqueta GCM.
  if (payload.length > recordSize - 1 - 16 - 86)
    throw new Error("El mensaje push es demasiado grande.");

  let senderPublic: Bytes;
  let senderPrivate: CryptoKey;
  if (options.senderKeys) {
    senderPublic = options.senderKeys.publicKey;
    senderPrivate = await importPrivateKey(
      options.senderKeys.privateKey,
      senderPublic,
      "ECDH",
    );
  } else {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    senderPublic = new Uint8Array(
      await crypto.subtle.exportKey("raw", pair.publicKey),
    );
    senderPrivate = pair.privateKey;
  }
  const receiverKey = await crypto.subtle.importKey(
    "raw",
    receiverPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: receiverKey },
      senderPrivate,
      256,
    ),
  );

  const keyInfo = concat(
    encoder.encode("WebPush: info\0"),
    receiverPublic,
    senderPublic,
  );
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);
  const salt = options.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const contentKey = await hkdf(
    salt,
    ikm,
    encoder.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    encoder.encode("Content-Encoding: nonce\0"),
    12,
  );

  const aesKey = await crypto.subtle.importKey(
    "raw",
    contentKey,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      concat(payload, new Uint8Array([2])),
    ),
  );

  const header = new Uint8Array(16 + 4 + 1);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, recordSize);
  header[20] = senderPublic.length;
  return concat(header, senderPublic, ciphertext);
}

export interface VapidKeys {
  /** Clave pública sin comprimir (65 bytes), base64url. */
  publicKey: string;
  /** Escalar privado (32 bytes), base64url. */
  privateKey: string;
  /** Contacto del remitente: `mailto:` o URL https. */
  subject: string;
}

/** Cabecera Authorization de VAPID para el servicio push del endpoint. */
export async function vapidAuthorization(
  endpoint: string,
  vapid: VapidKeys,
  now = Date.now(),
) {
  if (!/^(mailto:|https:\/\/)/.test(vapid.subject))
    throw new Error("El contacto VAPID debe empezar por mailto: o https://.");
  const publicKey = decodeBase64Url(vapid.publicKey);
  const key = await importPrivateKey(
    decodeBase64Url(vapid.privateKey),
    publicKey,
    "ECDSA",
  );
  const json = (value: unknown) =>
    encodeBase64Url(encoder.encode(JSON.stringify(value)));
  const unsigned =
    json({ typ: "JWT", alg: "ES256" }) +
    "." +
    json({
      aud: new URL(endpoint).origin,
      exp: Math.floor(now / 1000) + 12 * 60 * 60,
      sub: vapid.subject,
    });
  const signature = new Uint8Array(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      encoder.encode(unsigned),
    ),
  );
  return `vapid t=${unsigned}.${encodeBase64Url(signature)}, k=${vapid.publicKey}`;
}

export interface PushTarget extends PushSubscriptionKeys {
  endpoint: string;
}

const pushHosts = [
  /^fcm\.googleapis\.com$/,
  /^([a-z0-9-]+\.)*push\.apple\.com$/,
  /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/,
  /^[a-z0-9-]+\.notify\.windows\.com$/,
];

/** Solo se envía a servicios push conocidos para no hacer peticiones arbitrarias. */
export function isKnownPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      pushHosts.some((host) => host.test(url.hostname))
    );
  } catch {
    return false;
  }
}

export async function createPushRequest(
  target: PushTarget,
  payload: unknown,
  vapid: VapidKeys,
  { ttl = 6 * 60 * 60, urgency = "high" } = {},
) {
  if (!isKnownPushEndpoint(target.endpoint))
    throw new Error("El endpoint no pertenece a un servicio push conocido.");
  const body = await encryptPayload(
    target,
    encoder.encode(JSON.stringify(payload)),
  );
  return new Request(target.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidAuthorization(target.endpoint, vapid),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
}
