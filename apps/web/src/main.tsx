import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { Button } from "@/components/ui/button";
import "./index.css";

function App() {
  const [verified, setVerified] = useState(false);

  return (
    <main className="mx-auto flex min-h-svh max-w-xl flex-col items-start justify-center gap-4 px-6">
      <h1 className="text-4xl font-semibold tracking-tight">Organify</h1>
      <Button type="button" onClick={() => setVerified(true)}>
        Probar la interfaz
      </Button>
      <p role="status">{verified ? "La interfaz responde." : ""}</p>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("No se encontró el elemento raíz.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
