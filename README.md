# Organify

## Desarrollo

Usa Node.js 24 y pnpm 10.30.3. Desde la raíz del proyecto:

```powershell
corepack pnpm install
corepack pnpm dev
```

Abre la URL que indica Vite, normalmente http://localhost:5173. Si pnpm ya está
disponible en tu terminal, puedes omitir el prefijo `corepack`.

Las fases se desarrollan en la rama `dev`. Una vez verificada una fase, se puede
integrar en `main`.

## Fase 1 · MVP local

1. Crea un proyecto y captura «Reunión con Ana mañana a las 10:00». Comprueba
   que el título queda en «Reunión con Ana» y que la fecha aparece en
   **Próximas**. Crea «Comprar pan» y comprueba **Sin fecha**.
2. Abre la tarea, edita el título o las notas y guarda. Puedes cambiar el
   proyecto desde el detalle.
3. Cambia a **Tablero** y arrastra el asa de una tarjeta a otra columna.
   También puedes enfocar el asa, pulsar **Espacio**, usar **←** o **→** y
   pulsar **Espacio** de nuevo. Vuelve a **Lista** y comprueba el nuevo estado.
4. Abre la paleta con **Ctrl+K** o **⌘K**. Escribe «tablero» y pulsa Enter.
   Recarga la página desde el mismo origen y comprueba que siguen allí los
   proyectos, las notas y los cambios de estado.
5. Elimina una tarea, confirma y recarga. Debe desaparecer de ambas vistas.

Los datos permanecen en la IndexedDB del navegador. Dexie queda encapsulado
en `@organify/storage`. Los repositorios usan UUIDv7 de `uuid`, claves de
orden de `fractional-indexing` y borrado lógico. El tablero añade la tarjeta
al final de la columna de destino.

## Fase 2 · Calendario

Abre **Calendario** desde las vistas o la paleta de comandos. Cambia entre
mes, semana y agenda. Selecciona un proyecto para ver sus tareas.

En el detalle, elige una fecha y, si quieres, una hora. Puedes repetir la
tarea a diario, semanalmente o cada mes. Arrastra una tarea en la vista
de mes o semana para reprogramarla. Arrastrar una ocurrencia mueve toda
la serie, que comparte el título, las notas y el estado de la tarea.

Para comprobar el flujo, programa una tarea semanal, arrastra una
ocurrencia y recarga. Revisa que el nuevo horario se conserve en el
detalle y que la serie aparezca en la siguiente semana.

## Comprobaciones

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm preview
```

La compilación genera `apps/web/dist`. Abre la URL indicada por `preview`
para comprobar esa versión. Un puerto distinto implica un origen distinto y
una base local independiente.
