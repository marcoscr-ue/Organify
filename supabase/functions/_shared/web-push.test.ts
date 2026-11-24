import { describe, expect, it } from "vitest";
import {
  createPushRequest,
  decodeBase64Url,
  encodeBase64Url,
  encryptPayload,
  isKnownPushEndpoint,
  vapidAuthorization,
} from "./web-push";

const encoder = new TextEncoder();

// RFC 8291, sección 5 y apéndice A.
const rfc = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic:
    "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic:
    "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  message:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

async function receiver() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    privateKey: pair.privateKey,
    publicKey,
    keys: { p256dh: encodeBase64Url(publicKey), auth: encodeBase64Url(auth) },
    auth,
  };
}

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
) {
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

// Descifrado del lado del navegador, para comprobar el formato completo.
async function decrypt(
  message: Uint8Array<ArrayBuffer>,
  ua: Awaited<ReturnType<typeof receiver>>,
) {
  const salt = message.slice(0, 16);
  const idLength = message[20];
  const senderPublic = message.slice(21, 21 + idLength);
  const sender = await crypto.subtle.importKey(
    "raw",
    senderPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: sender },
      ua.privateKey,
      256,
    ),
  );
  const info = new Uint8Array([
    ...encoder.encode("WebPush: info\0"),
    ...ua.publicKey,
    ...senderPublic,
  ]);
  const ikm = await hkdf(ua.auth, shared, info, 32);
  const cek = await hkdf(
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
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "decrypt",
  ]);
  const padded = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      message.slice(21 + idLength),
    ),
  );
  expect(padded.at(-1)).toBe(2);
  return new TextDecoder().decode(padded.slice(0, -1));
}

describe("encryptPayload", () => {
  it("reproduce el vector de prueba del RFC 8291", async () => {
    const message = await encryptPayload(
      { p256dh: rfc.uaPublic, auth: rfc.authSecret },
      encoder.encode(rfc.plaintext),
      {
        salt: decodeBase64Url(rfc.salt),
        senderKeys: {
          publicKey: decodeBase64Url(rfc.asPublic),
          privateKey: decodeBase64Url(rfc.asPrivate),
        },
      },
    );
    expect(encodeBase64Url(message)).toBe(rfc.message);
  });

  it("produce un mensaje que el navegador puede descifrar", async () => {
    const ua = await receiver();
    const message = await encryptPayload(
      ua.keys,
      encoder.encode('{"v":1,"reminder":"abc"}'),
    );
    expect(await decrypt(message, ua)).toBe('{"v":1,"reminder":"abc"}');
  });

  it("rechaza claves de suscripción mal formadas", async () => {
    const ua = await receiver();
    await expect(
      encryptPayload({ ...ua.keys, auth: "AAAA" }, new Uint8Array()),
    ).rejects.toThrow();
    await expect(
      encryptPayload({ ...ua.keys, p256dh: "AAAA" }, new Uint8Array()),
    ).rejects.toThrow();
  });
});

async function vapidKeys() {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  return {
    verifyKey: pair.publicKey,
    keys: {
      publicKey: encodeBase64Url(
        new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey)),
      ),
      privateKey: jwk.d!,
      subject: "mailto:avisos@example.com",
    },
  };
}

describe("vapidAuthorization", () => {
  it("firma un JWT ES256 para el origen del servicio push", async () => {
    const { keys, verifyKey } = await vapidKeys();
    const now = Date.UTC(2026, 10, 24);
    const header = await vapidAuthorization(
      "https://fcm.googleapis.com/fcm/send/abc",
      keys,
      now,
    );
    const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, head, claims, signature, publicKey] = match!;
    expect(publicKey).toBe(keys.publicKey);
    expect(
      JSON.parse(new TextDecoder().decode(decodeBase64Url(claims))),
    ).toEqual({
      aud: "https://fcm.googleapis.com",
      exp: now / 1000 + 12 * 60 * 60,
      sub: keys.subject,
    });
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        verifyKey,
        decodeBase64Url(signature),
        encoder.encode(head + "." + claims),
      ),
    ).toBe(true);
  });

  it("exige un contacto mailto: o https", async () => {
    const { keys } = await vapidKeys();
    await expect(
      vapidAuthorization("https://web.push.apple.com/x", {
        ...keys,
        subject: "yo",
      }),
    ).rejects.toThrow();
  });
});

describe("createPushRequest", () => {
  it("solo envía a servicios push conocidos", () => {
    expect(isKnownPushEndpoint("https://fcm.googleapis.com/fcm/send/a")).toBe(
      true,
    );
    expect(isKnownPushEndpoint("https://web.push.apple.com/QabC")).toBe(true);
    expect(
      isKnownPushEndpoint(
        "https://updates.push.services.mozilla.com/wpush/v2/a",
      ),
    ).toBe(true);
    expect(
      isKnownPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=a"),
    ).toBe(true);
    expect(isKnownPushEndpoint("http://fcm.googleapis.com/a")).toBe(false);
    expect(isKnownPushEndpoint("https://push.apple.com.evil.test/a")).toBe(
      false,
    );
    expect(isKnownPushEndpoint("https://localhost/a")).toBe(false);
    expect(isKnownPushEndpoint("https://fcm.googleapis.com:8443/a")).toBe(
      false,
    );
  });

  it("prepara la petición cifrada con VAPID", async () => {
    const ua = await receiver();
    const { keys } = await vapidKeys();
    const request = await createPushRequest(
      { endpoint: "https://web.push.apple.com/abc", ...ua.keys },
      { v: 1, reminder: "r1" },
      keys,
    );
    expect(request.method).toBe("POST");
    expect(request.headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(request.headers.get("TTL")).toBe("21600");
    expect(request.headers.get("Urgency")).toBe("high");
    expect(request.headers.get("Authorization")).toMatch(/^vapid t=/);
    const body = new Uint8Array(await request.arrayBuffer());
    expect(JSON.parse(await decrypt(body, ua))).toEqual({
      v: 1,
      reminder: "r1",
    });
  });
});
