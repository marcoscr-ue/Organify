import sodium from "libsodium-wrappers-sumo";
import { parseOp, type Op } from "@organify/core";

export interface Box {
  v: 1;
  nonce: string;
  ciphertext: string;
}

export interface KeyEnvelope {
  v: 1;
  kdf: { salt: string; ops: 3; memory: 67108864 };
  passphrase: Box;
  recovery: Box;
}

function seal(
  message: string | Uint8Array,
  key: Uint8Array,
  context: string,
): Box {
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  return {
    v: 1,
    nonce: sodium.to_base64(nonce),
    ciphertext: sodium.to_base64(
      sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        message,
        context,
        null,
        nonce,
        key,
      ),
    ),
  };
}

function open(box: Box, key: Uint8Array, context: string): Uint8Array {
  if (box.v !== 1) throw new Error("Versión de cifrado incompatible");
  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    sodium.from_base64(box.ciphertext),
    context,
    sodium.from_base64(box.nonce),
    key,
  );
}

function derive(passphrase: string, kdf: KeyEnvelope["kdf"]): Uint8Array {
  if (kdf.ops !== 3 || kdf.memory !== 67108864)
    throw new Error("Parámetros Argon2id incompatibles");
  return sodium.crypto_pwhash(
    32,
    passphrase,
    sodium.from_base64(kdf.salt),
    kdf.ops,
    kdf.memory,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

function keyContext(userId: string, purpose: string): string {
  return JSON.stringify(["organify-key", 1, userId, purpose]);
}

export async function createKeyEnvelope(userId: string, passphrase: string) {
  if (!passphrase.trim()) throw new Error("Introduce una frase de cifrado");
  await sodium.ready;
  const key = sodium.randombytes_buf(32);
  const recovery = sodium.randombytes_buf(32);
  const kdf = {
    salt: sodium.to_base64(
      sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES),
    ),
    ops: 3,
    memory: 67108864,
  } as const;
  const derived = derive(passphrase, kdf);
  try {
    const envelope: KeyEnvelope = {
      v: 1,
      kdf,
      passphrase: seal(key, derived, keyContext(userId, "passphrase")),
      recovery: seal(key, recovery, keyContext(userId, "recovery")),
    };
    return { key, envelope, recoveryKey: sodium.to_base64(recovery) };
  } finally {
    sodium.memzero(derived);
    sodium.memzero(recovery);
  }
}

export async function unlockKey(
  userId: string,
  envelope: KeyEnvelope,
  secret: string,
  method: "passphrase" | "recovery",
): Promise<Uint8Array> {
  await sodium.ready;
  if (envelope.v !== 1) throw new Error("Versión de envoltura incompatible");
  const derived =
    method === "passphrase"
      ? derive(secret, envelope.kdf)
      : sodium.from_base64(secret.trim());
  try {
    return open(envelope[method], derived, keyContext(userId, method));
  } finally {
    sodium.memzero(derived);
  }
}

export function createOpCodec(userId: string, key: Uint8Array) {
  const context = (id: string, device: string) =>
    JSON.stringify(["organify-op", 1, userId, id, device]);
  return {
    async seal(op: Op): Promise<string> {
      await sodium.ready;
      return JSON.stringify(
        seal(JSON.stringify(op), key, context(op.id, op.deviceId)),
      );
    },
    async open(change: {
      opId: string;
      deviceId: string;
      ciphertext: string;
    }): Promise<Op> {
      await sodium.ready;
      const op = parseOp(
        JSON.parse(
          sodium.to_string(
            open(
              JSON.parse(change.ciphertext),
              key,
              context(change.opId, change.deviceId),
            ),
          ),
        ),
      );
      if (op.id !== change.opId || op.deviceId !== change.deviceId)
        throw new Error("Metadatos de operación inválidos");
      return op;
    },
  };
}
