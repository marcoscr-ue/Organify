import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { URL } from "node:url";

const main = new URL("./android/app/src/main/", import.meta.url);
const manifest = new URL("AndroidManifest.xml", main);
const iconFolder = new URL("res/drawable-nodpi/", main);
const icon = new URL("../web/public/icon-192.png", import.meta.url);
const original = await readFile(manifest, "utf8");
const application = original.match(/<application\b[^>]*>/)?.[0];

if (!application || !/\bandroid:icon\s*=/.test(application)) {
  throw new Error(
    "No se encontró el icono de la aplicación en AndroidManifest.xml.",
  );
}

const updated = original.replace(
  application,
  application.replace(
    /\bandroid:(icon|roundIcon)\s*=\s*"[^"]*"/g,
    'android:$1="@drawable/organify_app_icon"',
  ),
);
await mkdir(iconFolder, { recursive: true });
await copyFile(icon, new URL("organify_app_icon.png", iconFolder));
if (updated !== original) await writeFile(manifest, updated);
