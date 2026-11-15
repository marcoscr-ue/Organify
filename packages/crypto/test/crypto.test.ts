import { expect, it } from "vitest";
import { createKeyEnvelope, createOpCodec, unlockKey } from "../src/index";

it("recupera la misma clave y autentica la cuenta, la operación y el dispositivo", async () => {
  const { key, envelope, recoveryKey } = await createKeyEnvelope(
    "user",
    "frase de prueba extensa",
  );
  expect(await unlockKey("user", envelope, recoveryKey, "recovery")).toEqual(
    key,
  );
  expect(
    await unlockKey("user", envelope, "frase de prueba extensa", "passphrase"),
  ).toEqual(key);
  await expect(
    unlockKey("other", envelope, recoveryKey, "recovery"),
  ).rejects.toThrow();
  const op = {
    v: 1,
    id: "op",
    deviceId: "device",
    hlc: "1:0",
    entity: "item",
    entityId: "item",
    kind: "set",
    field: "title",
    value: "secreto",
  } as const;
  const codec = createOpCodec("user", key);
  const ciphertext = await codec.seal(op);
  expect(ciphertext).not.toContain("secreto");
  expect(await codec.seal(op)).not.toBe(ciphertext);
  expect(
    await codec.open({ opId: op.id, deviceId: op.deviceId, ciphertext }),
  ).toEqual(op);
  await expect(
    codec.open({ opId: "other", deviceId: op.deviceId, ciphertext }),
  ).rejects.toThrow();
});
