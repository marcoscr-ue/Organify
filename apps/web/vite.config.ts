import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

function offlineShell(): Plugin {
  const publicFiles = [
    "manifest.webmanifest",
    "icon-192.png",
    "icon-512.png",
    "icon-maskable-512.png",
    "apple-touch-icon.png",
    "organify-favicon.png",
  ];
  return {
    name: "organify-offline-shell",
    apply: "build",
    enforce: "post",
    generateBundle(_, bundle) {
      const worker = readFileSync(
        new URL("./sw.template.js", import.meta.url),
        "utf8",
      );
      const hash = createHash("sha256").update(worker);
      for (const file of publicFiles) {
        hash.update(readFileSync(new URL("./public/" + file, import.meta.url)));
      }
      for (const asset of Object.values(bundle)) {
        hash.update(asset.type === "chunk" ? asset.code : asset.source);
      }
      const files = new Set(["./", ...publicFiles.map((file) => `./${file}`)]);
      for (const file of Object.keys(bundle)) {
        if (file !== "index.html") files.add(`./${file}`);
      }
      this.emitFile({
        type: "asset",
        fileName: "sw.js",
        source: worker
          .replace("__BUILD_ID__", hash.digest("hex").slice(0, 16))
          // La plantilla contiene JSON.parse("__BUILD_FILES__"): se sustituye
          // el literal completo por una cadena JSON escapada.
          .replace(
            '"__BUILD_FILES__"',
            JSON.stringify(JSON.stringify([...files])),
          ),
      });
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss(), offlineShell()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
