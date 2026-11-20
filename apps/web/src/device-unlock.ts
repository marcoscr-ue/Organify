import type { SavedDeviceUnlock } from "@organify/storage";

type UnlockContext = Pick<
  SavedDeviceUnlock,
  "projectUrl" | "userId" | "envelopeId"
>;

export function canRememberUnlock() {
  return Boolean(globalThis.crypto?.subtle && globalThis.indexedDB);
}

function associatedData({ projectUrl, userId, envelopeId }: UnlockContext) {
  return new TextEncoder().encode(
    JSON.stringify([
      "organify-device-unlock",
      1,
      projectUrl,
      userId,
      envelopeId,
    ]),
  );
}

export async function protectDeviceUnlock(
  context: UnlockContext,
  masterKey: Uint8Array,
): Promise<SavedDeviceUnlock> {
  const deviceKey = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(context) },
    deviceKey,
    new Uint8Array(masterKey),
  );
  return { ...context, v: 1, deviceKey, iv, ciphertext };
}

export async function openDeviceUnlock(saved: SavedDeviceUnlock) {
  if (saved.v !== 1) throw new Error("Desbloqueo guardado incompatible.");
  const key = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: saved.iv, additionalData: associatedData(saved) },
    saved.deviceKey,
    saved.ciphertext,
  );
  return new Uint8Array(key);
}
