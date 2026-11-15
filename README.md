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

## Fase 3 · Sincronización cifrada

Aplica la migración de `supabase/migrations` en un proyecto de Supabase de
pruebas y crea un usuario de correo y contraseña en Authentication. Define
`VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en `apps/web/.env.local`
y reinicia Vite. Usa la clave pública del proyecto.

En **Sincronización**, conecta el primer dispositivo con una frase de
cifrado distinta de la contraseña de acceso. Marca **Configurar el primer
dispositivo** y copia la clave de recuperación. En un segundo perfil de
navegador, conecta con la misma cuenta y desbloquea con la frase de cifrado
o la clave de recuperación. Tras recargar, vuelve a desbloquear para activar
la sincronización de nuevo.

Para comprobar la convergencia, desconecta temporalmente la red, edita el
título en un perfil y las notas en el otro, y vuelve a conectar ambos.
Comprueba los dos cambios desde un tercer perfil vacío. La base local queda
vinculada a la primera cuenta que se conecta. Usa otro perfil de navegador
para otra cuenta. Las tareas siguen disponibles localmente al desconectar.

La sincronización cifra el contenido que sale del dispositivo. IndexedDB
conserva las tareas legibles en el dispositivo. Las notas simples se fusionan
como un campo y la edición colaborativa de texto con Yjs corresponde a la
Fase 5.

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

## Fase 4 · Instalar Organify y probar recordatorios

Desde la raíz de `dev`, usa Node.js 24 y ejecuta:

```powershell
corepack pnpm install
corepack pnpm typecheck
corepack pnpm test
```

Incluye el `pnpm-lock.yaml` actualizado en el commit, ya que CI usa una
instalación congelada. Los empaquetados usan el mismo `apps/web/dist`.
Si quieres sincronizar, configura `apps/web/.env.local` como en la Fase 3
antes de compilar. Cada instalación tiene su propio almacenamiento local.

### PWA en Chrome

1. Ejecuta `corepack pnpm build` y luego `corepack pnpm preview`.
2. Abre la URL de Vite. En Chrome, usa el icono de instalación junto a la
   barra de direcciones o busca **Instalar Organify** en el menú.
3. Abre la app instalada en línea y espera a que se active el service
   worker. Cierra y vuelve a abrir Organify con la conexión desactivada.
   Crea una tarea y comprueba que se conserva al volver a abrir la app.
   Para probar en localhost, deja el servidor preview arrancado y usa
   **DevTools → Network → Offline** antes de recargar. Un despliegue
   público requiere HTTPS.

### Windows con Tauri

Instala Rust estable con rustup, Microsoft C++ Build Tools (carga de trabajo
**Desarrollo para el escritorio con C++**) y WebView2 según
[los requisitos de Tauri](https://v2.tauri.app/start/prerequisites/).

```powershell
corepack pnpm --filter @organify/desktop desktop:dev
corepack pnpm --filter @organify/desktop desktop:build
```

Ejecuta esos comandos por separado. Para compilar, cierra primero la
ventana de desarrollo. Busca el instalador NSIS en
`apps/desktop/src-tauri/target/release/bundle/nsis`. Instálalo y abre
Organify desde el menú Inicio para probar los avisos de Windows.

### Android con Capacitor

Instala [Android Studio y el SDK de Android 36](https://capacitorjs.com/docs/getting-started/environment-setup).

```powershell
corepack pnpm build
corepack pnpm --filter @organify/mobile android:add
corepack pnpm --filter @organify/mobile android:sync
corepack pnpm --filter @organify/mobile android:open
```

Ejecuta `android:add` una vez por checkout. El proyecto Android se genera
localmente en `apps/mobile/android`. Tras cambiar la app, vuelve a ejecutar
`android:sync`. En Android Studio, elige un emulador o un teléfono con
depuración USB y pulsa **Run**. Para obtener un APK de depuración, usa el
menú **Build** de Android Studio o ejecuta `.gradlew.bat assembleDebug`
desde `apps/mobile/android`.

### Recordatorios locales

1. Abre el detalle de una tarea, busca **Recordatorio en este dispositivo**
   y elige una hora unos minutos por delante.
2. Pulsa **Programar** y concede el permiso que aparezca. El aviso muestra
   un mensaje genérico para evitar exponer el título en la pantalla.
3. En Chrome y Windows, deja la app abierta hasta que llegue el aviso. En
   Android, vuelve a Inicio y comprueba que llega con la app en segundo
   plano. Android puede retrasar el aviso según sus ajustes de batería.
4. Programa otro aviso y pulsa **Cancelar recordatorio** antes de la hora.

Se programa un aviso puntual por tarea y dispositivo. Los avisos se
configuran independientemente de las fechas y recurrencias del calendario.
