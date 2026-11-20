import Dexie from "dexie";

export interface SavedDeviceUnlock {
  projectUrl: string;
  userId: string;
  envelopeId: string;
  v: 1;
  deviceKey: CryptoKey;
  iv: Uint8Array<ArrayBuffer>;
  ciphertext: ArrayBuffer;
}

export function createDeviceUnlockStore() {
  // Keep this separate so older clients can still open the task database.
  const db = new Dexie("organify-device-unlock");
  db.version(1).stores({ keys: "projectUrl" });
  const keys = db.table<SavedDeviceUnlock, string>("keys");
  return {
    read: (projectUrl: string) => keys.get(projectUrl),
    async save(unlock: SavedDeviceUnlock) {
      await keys.put(unlock);
    },
    forget: (projectUrl: string) => keys.delete(projectUrl),
  };
}
