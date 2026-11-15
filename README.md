# Organify

## Fase 0

Usa Node.js 24 y pnpm 10.30.3. Desde la raíz del proyecto:

```powershell
corepack pnpm install
corepack pnpm dev
```

Abre la URL que indica Vite, normalmente http://localhost:5173. Pulsa
**Probar la interfaz** y comprueba que aparece «La interfaz responde.».

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm preview
```

Vitest debe ejecutar cuatro pruebas, una por paquete. La compilación genera
`apps/web/dist`. Abre la URL indicada por `preview` para comprobar esa versión.

El workspace contiene `apps/web` y cuatro paquetes privados con un punto de
entrada vacío. Tailwind se integra mediante su plugin de Vite. La web incluye
un botón de shadcn/ui con Radix Slot, CVA y utilidades para combinar clases.
ESLint, Prettier, TypeScript y Vitest se ejecutan durante el desarrollo y en CI.

Si pnpm ya está disponible en tu terminal, puedes omitir el prefijo `corepack`.
Guarda e incorpora `pnpm-lock.yaml` al repositorio después de la primera
instalación para que CI pueda usar una instalación congelada.
