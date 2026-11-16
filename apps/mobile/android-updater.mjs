import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";

const endpoint = process.env.ORGANIFY_ANDROID_UPDATER_ENDPOINT?.trim() ?? "";
if (endpoint && new URL(endpoint).protocol !== "https:") {
  throw new Error("El manifiesto de actualizaciones Android debe usar HTTPS.");
}

const main = new URL("./android/app/src/main/", import.meta.url);
const manifest = new URL("AndroidManifest.xml", main);
const original = await readFile(manifest, "utf8");
const updated = original.replace(
  /(<activity\b[^>]*\bandroid:name\s*=\s*")(?:app\.organify\.personal\.|\.)MainActivity(")/,
  "$1app.organify.personal.UpdateActivity$2",
);
if (updated === original && !original.includes('"app.organify.personal.UpdateActivity"')) {
  throw new Error("No se encontró MainActivity en AndroidManifest.xml.");
}

const sources = new URL("java/app/organify/personal/", main);
const assets = new URL("assets/", main);
await mkdir(sources, { recursive: true });
await mkdir(assets, { recursive: true });
await copyFile(
  new URL("./android-native/UpdateActivity.java", import.meta.url),
  new URL("UpdateActivity.java", sources),
);
await writeFile(new URL("organify-update-endpoint.txt", assets), endpoint);
if (updated !== original) await writeFile(manifest, updated);
