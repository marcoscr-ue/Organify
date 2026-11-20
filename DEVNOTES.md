# Notas de desarrollo de Organify

## Preparar el entorno de desarrollo

Esta guía está pensada para Windows y PowerShell. El código de las fases se trabaja en `dev`; la rama estable es `main`.

### Herramientas para web y PWA

1. Instala Node.js 24 LTS desde [nodejs.org](https://nodejs.org/). Cierra y vuelve a abrir PowerShell.
2. Desde la carpeta del proyecto, activa pnpm mediante Corepack e instala las dependencias:

```powershell
corepack enable
corepack prepare pnpm@10.30.3 --activate
corepack pnpm install
```

3. Comprueba las herramientas:

```powershell
node --version
corepack pnpm --version
```

Se espera Node 24 y pnpm 10.30.3. Si pnpm muestra que bloqueó scripts de instalación, ejecuta `corepack pnpm approve-builds`, selecciona los paquetes de compilación solicitados y vuelve a ejecutar `corepack pnpm install`.

Para desarrollar la versión web:

```powershell
corepack pnpm dev
```

Abre la URL que muestra Vite, normalmente `http://localhost:5173`. Para detener el servidor, pulsa `Ctrl+C`.

### Variables para sincronización opcional

La app funciona sin una cuenta de Supabase. Para incluir un proyecto en la compilación, copia `apps/web/.env.example` a `apps/web/.env.local` y rellena la URL y la clave pública. Reinicia Vite en desarrollo o vuelve a compilar para desplegar en web, Windows o Android. En un alojamiento web que compile el repositorio, define `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` en el entorno de compilación.

Si la instalación no incluye un proyecto, abre **Cuenta → Configurar Supabase** e introduce la URL base del proyecto y su clave pública `sb_publishable_…` o `anon`. Usa **Cambiar configuración de Supabase** si necesitas corregir esos datos. El correo y la contraseña se introducen después en el formulario de acceso. Configura la base de datos según la sección **Fase 3**. Reserva `sb_secret_…` y `service_role` para el servidor.

## Comprobar cambios

Desde la raíz:

```powershell
corepack pnpm format:check
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

Para abrir localmente la compilación web:

```powershell
corepack pnpm preview
```

La salida web se genera en `apps/web/dist`. Cambiar el puerto de `preview` crea otro origen y, por tanto, una base IndexedDB independiente.

## Preparar compilación de escritorio para Windows

Tauri compila Rust y la aplicación web. Instala lo siguiente:

1. **Rust estable** con [rustup](https://www.rust-lang.org/tools/install). En el instalador de Windows acepta la opción predeterminada de Visual Studio C++ Build Tools si te la ofrece.
2. **Microsoft C++ Build Tools** desde [Visual Studio Downloads](https://visualstudio.microsoft.com/visual-cpp-build-tools/). En Visual Studio Installer, marca la carga **Desarrollo para el escritorio con C++**. Unreal Engine puede haber instalado componentes compatibles, pero si Rust informa que falta `link.exe` o el compilador, verifica esta carga.
3. **Microsoft Edge WebView2 Runtime**. Windows 11 suele incluirlo. Si Tauri indica que falta, instálalo desde [la página de WebView2](https://developer.microsoft.com/microsoft-edge/webview2/).

Abre una PowerShell nueva y verifica Rust:

```powershell
rustc --version
cargo --version
```

Desde la raíz del repositorio, inicia la app de escritorio para desarrollo:

```powershell
corepack pnpm --filter @organify/desktop desktop:dev
```

Para crear el instalador, cierra primero la app de desarrollo y ejecuta:

```powershell
corepack pnpm --filter @organify/desktop desktop:build
```

El instalador NSIS `.exe` queda en `apps/desktop/src-tauri/target/release/bundle/nsis`. La primera compilación descarga y compila dependencias de Rust, por eso tarda más. La notificación de Windows funciona en una aplicación instalada.

## Preparar compilación Android

Capacitor usa Android Studio para compilar la app. Instala [Android Studio](https://developer.android.com/studio) y, desde SDK Manager, Android SDK Platform 36 y las herramientas recomendadas. Capacitor 8 requiere Android Studio 2025.2.1 o posterior. Para usar un teléfono, activa las opciones de desarrollador y la depuración USB. También puedes crear un emulador en Device Manager.

Desde la raíz, genera el proyecto Android una vez por checkout:

```powershell
corepack pnpm --filter @organify/mobile android:add
```

Para compilar la web, copiarla a Android y abrir el proyecto en Android Studio:

```powershell
corepack pnpm --filter @organify/mobile android:sync
corepack pnpm --filter @organify/mobile android:open
```

En Android Studio, selecciona el teléfono o emulador y pulsa **Run**. Para crear un APK de depuración, usa **Build → Build APK(s)**. Android Studio mostrará la ruta del APK al terminar.

La carpeta `apps/mobile/android` se genera localmente y no se incluye en Git. Conserva los cambios específicos de Android hechos desde Android Studio y repite `android:add` solo si necesitas regenerar por completo el proyecto nativo.

### Publicar todos los artefactos en una release

El workflow **Publicar Multiplataforma** prepara un borrador de GitHub Release con el instalador NSIS y los artefactos del actualizador de Windows. Después adjunta un ZIP de `apps/web/dist` y compila un APK de release firmado, que también añade al mismo borrador.

Antes de ejecutar el workflow, añade estos secretos en **Settings → Secrets and variables → Actions**:

- `ANDROID_KEYSTORE_BASE64`: contenido Base64 del archivo `.jks` o `.keystore`.
- `ANDROID_KEYSTORE_PASSWORD`: contraseña del keystore.
- `ANDROID_KEY_ALIAS`: alias de la clave.
- `ANDROID_KEY_PASSWORD`: contraseña de la clave.

Las dos contraseñas deben contener solo caracteres ASCII; puedes usar letras inglesas, números y símbolos ASCII. Deben ser las credenciales de la misma clave que utilizaste para firmar la APK que ya probaste.

En PowerShell puedes convertir el keystore a Base64 para pegarlo como secreto:

```powershell
[Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\ruta-segura\organify-release.jks")) | Set-Clipboard
```

El workflow usa el número de versión de `apps/mobile/package.json` como `versionName` y deriva un `versionCode` creciente de la versión semántica. La compilación Android apunta el actualizador al manifiesto `android.json` de la última release publicada. Este manifiesto enlaza al APK firmado de su versión. Mantén la misma clave de firma en todas las versiones.

Ejecuta **Actions → Publicar Multiplataforma → Run workflow** desde la rama que contiene la versión que quieres publicar. Cuando terminen los trabajos, abre el borrador, comprueba que aparecen el instalador de Windows, `latest.json`, `Organify-PWA-v<versión>.zip` y `Organify-android-v<versión>.apk`, y publica la release. GitHub añade automáticamente los enlaces **Source code (zip)** y **Source code (tar.gz)** al publicar la release.

### Publicar una sola plataforma

En Actions también están **Publicar Windows**, **Publicar Android** y **Publicar PWA**. Cada uno compila únicamente esa plataforma y adjunta sus archivos al borrador `v<versión>`. Puedes ejecutar varios para completar el mismo borrador desde el mismo commit. La publicación final sigue siendo manual. PWA genera un ZIP listo para alojar; el workflow no despliega el sitio.

Para un parche exclusivo de Windows, incrementa la versión en el paquete desktop, Tauri y Cargo y ejecuta **Publicar Windows**. El borrador usa la versión superior de Windows y conserva el `android.json` de la última release publicada. Comprueba que el borrador contiene el instalador firmado, `latest.json` con la versión de Windows y `android.json` con el enlace al APK anterior. Publícalo como release estable y selecciónalo como **Latest release** para que lo detecten los clientes existentes. El campo `releaseLabel` del paquete desktop establece el nombre visible del parche en GitHub.

Para la siguiente release común, alinea los paquetes web, desktop y mobile, Tauri y Cargo con una versión superior a la de Windows. Los workflows rechazan una release ya publicada y una etiqueta que apunta a otro commit.

Windows y Android consultan `releases/latest/download`. Conserva `latest.json` y `android.json` en la release marcada como **Latest release** para que ambos puedan detectar actualizaciones. Las prereleases quedan fuera de ese enlace.

## Qué reconstruir cuando cambia la app

- **Código web, estilos o dependencias compartidas:** ejecuta las comprobaciones y recompila el destino que quieras usar. Para PWA, `corepack pnpm build` y vuelve a desplegar el contenido de `apps/web/dist`. Para Android, ejecuta `android:sync` y luego **Run** o genera un APK nuevo. Para Windows, ejecuta `desktop:build` de nuevo.
- **Cambios de Rust o configuración de Tauri:** vuelve a ejecutar `desktop:dev` para desarrollo o `desktop:build` para generar un instalador actualizado.
- **Cambios en plugins, permisos o configuración nativa de Android:** ejecuta `android:sync` y recompila desde Android Studio. Un cambio solo web también requiere `android:sync`, porque copia la nueva compilación web al proyecto Android.
- **Cambios de base de datos local:** Dexie actualiza la IndexedDB al abrir la app según sus versiones de esquema. No es necesario regenerar Rust ni Android por ese motivo, aunque cada plataforma guarda sus datos por separado.
- **Cambios SQL de Supabase:** aplica la nueva migración en el proyecto Supabase. No se empaquetan dentro del instalador.

No hace falta regenerar el proyecto Android ni reinstalar Rust por cada cambio. Sí hay que generar una nueva compilación/instalador/APK para que una versión distribuida incluya los cambios. Los proyectos generados y directorios `target` son artefactos locales e ignorados por Git.

## Fase 1 · MVP local

1. Crea un proyecto y captura «Reunión con Ana mañana a las 10:00». Comprueba que el título queda en «Reunión con Ana» y la fecha aparece en **Próximas**. Crea «Comprar pan» y comprueba **Sin fecha**.
2. Abre la tarea, edita el título o las notas y guarda. Puedes cambiar el proyecto desde el detalle.
3. Cambia el estado en la lista o marca la tarea como completada con el círculo.
4. Abre la paleta con **Ctrl+K** y escribe «Ir a Todas». Recarga y comprueba que se conservan los proyectos, las notas y los estados.
5. Elimina una tarea, confirma y recarga. Debe desaparecer de la lista.
6. Cambia a **Tablero** y arrastra una tarjeta a otra columna. Abre **Calendario** para ver las tareas con fecha y arrástralas para reprogramarlas.

Los datos se guardan en IndexedDB del navegador. Dexie queda encapsulado en `@organify/storage`. Los repositorios usan UUIDv7, claves de orden de `fractional-indexing` y borrado lógico.

## Fase 3 · Sincronización cifrada

En un proyecto Supabase de pruebas, aplica las migraciones de `supabase/migrations` desde **SQL Editor**, primero `202611150001_sync.sql` y luego `202611160001_sync_protocol.sql`. Si el proyecto ya tenía sincronización, aplica solo las migraciones pendientes. En **Authentication → Users**, crea un usuario con correo y contraseña y configura la conexión desde **Cuenta** o mediante las variables descritas arriba.

En **Sincronización**, conecta el primer dispositivo con una frase de cifrado distinta de la contraseña de acceso y de al menos 12 caracteres. Marca **Configurar el primer dispositivo** y guarda la clave de recuperación. En un segundo perfil de navegador, inicia sesión con la misma cuenta y desbloquea con la frase o la clave.

Para verificar el desbloqueo automático, marca **Mantener sesión iniciada** y **Recordar el desbloqueo en este dispositivo**, conecta y recarga. Comprueba que el indicador de Cuenta vuelve al estado verde. Pulsa **Olvidar desbloqueo** y recarga de nuevo. La sesión seguirá abierta y la app pedirá la frase o la clave de recuperación.

Para probar la convergencia, desconecta ambos perfiles, cambia el título en uno y las notas en el otro, reconéctalos y comprueba ambos cambios desde un tercer perfil. La base local queda vinculada a la primera cuenta conectada. Usa otro perfil para otra cuenta. Las tareas siguen disponibles localmente sin red.

La sincronización cifra el contenido que sale del dispositivo. IndexedDB conserva las tareas legibles localmente. La edición colaborativa con Yjs corresponde a la Fase 5.

## Fase 4 · PWA y recordatorios

### Instalar la PWA

Ejecuta `corepack pnpm build` y `corepack pnpm preview`. Abre la URL que indique Vite. En Chrome, usa el icono de instalación junto a la barra de direcciones o busca **Instalar Organify** en el menú. Para que funcione sin conexión, abre la app online al menos una vez para que se active el service worker. Un despliegue público requiere HTTPS.

### Probar recordatorios

Abre el editor de una tarea, elige una hora futura en **Recordatorio en este dispositivo** y pulsa **Guardar**. Concede el permiso si se solicita. El aviso usa un texto genérico en la pantalla bloqueada. Para cancelar el aviso, pulsa **Quitar recordatorio** y **Guardar**. En Chrome y Windows deja la app abierta. En Android puede llegar en segundo plano y el ahorro de batería puede retrasarlo. Los recordatorios son puntuales por tarea y dispositivo.

## Fase 5 · Descripción en bloques

Después de actualizar `dev`, ejecuta `corepack pnpm install` y guarda el
`pnpm-lock.yaml` actualizado junto al código. Para probarlo, arranca con
`corepack pnpm dev`.

- Abre una tarea, pulsa **Editar tarea** y escribe en **Descripción**. Prueba títulos, listas,
  citas y bloques de código. Espera a que aparezca **Guardado en este
  dispositivo** antes de cerrar. El texto de la versión anterior se puede
  consultar en **Nota de texto anterior** y copiar al editor.

Para probar la edición concurrente, actualiza ambos clientes a la Fase 5
y conéctalos a la misma cuenta. Crea una nota con dos párrafos y espera a
que aparezca en ambos. Con los dos clientes sin conexión, edita un párrafo
distinto en cada uno y vuelve a conectarlos. Comprueba que ambos cambios
aparecen en los dos clientes. Yjs fusiona los cambios y su contenido viaja
por la sincronización cifrada existente. Usa la misma configuración de
Supabase de la Fase 3.
