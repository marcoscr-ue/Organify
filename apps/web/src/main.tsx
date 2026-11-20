import { Capacitor } from "@capacitor/core";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { applyTheme, readDarkMode } from "./theme";
import "./index.css";

applyTheme(readDarkMode());

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el elemento raíz.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (
  import.meta.env.PROD &&
  "serviceWorker" in navigator &&
  !window.__TAURI__ &&
  !Capacitor.isNativePlatform()
) {
  void navigator.serviceWorker
    .register(import.meta.env.BASE_URL + "sw.js")
    .catch((error: unknown) =>
      console.error("No se pudo activar el modo sin conexión.", error),
    );
}
