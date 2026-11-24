import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { UpdateBanner } from "./pwa-settings";
import { registerServiceWorker } from "./pwa";
import { applyTheme, readDarkMode } from "./theme";
import "./index.css";

applyTheme(readDarkMode());

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el elemento raíz.");

createRoot(root).render(
  <StrictMode>
    <App />
    <UpdateBanner />
  </StrictMode>,
);

registerServiceWorker();
