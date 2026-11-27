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

Para preparar una versión experimental de Windows, mantén la versión base en web y móvil, y añade un sufijo SemVer como `-beta.1` a esa misma versión en el paquete desktop, Tauri y Cargo. Ejecuta **Publicar Windows**, comprueba que el borrador está marcado como prerelease y publica el instalador firmado con su `latest.json`. Conserva la misma clave de firma que para las versiones estables. Las instalaciones con **Ajustes → Avanzado → Probar actualizaciones experimentales** activado consultan las prereleases públicas del repositorio y eligen la versión de Windows más alta que supere a la instalada.

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

Ejecuta `corepack pnpm build` y `corepack pnpm preview`. Abre la URL que indique Vite. En Chrome, usa el icono de instalación junto a la barra de direcciones, busca **Instalar Organify** en el menú o pulsa **Instalar Organify** en **Ajustes → General**. En iPhone y iPad, abre la web en Safari, toca **Compartir → Añadir a pantalla de inicio** y abre la app desde el icono. Para que funcione sin conexión, abre la app online al menos una vez para que se active el service worker. Un despliegue público requiere HTTPS.

Al desplegar una versión nueva, la PWA abierta muestra **Hay una versión nueva de Organify**. **Actualizar** activa el nuevo service worker y recarga la app. La comprobación se repite al volver a primer plano cada 15 minutos como máximo.

### Probar recordatorios

Abre el editor de una tarea, elige una hora futura en **Recordatorio en este dispositivo** y pulsa **Guardar**. Concede el permiso si se solicita. El aviso usa un texto genérico en la pantalla bloqueada. Para cancelar el aviso, pulsa **Quitar recordatorio** y **Guardar**. En Chrome y Windows deja la app abierta, salvo que actives los avisos push. En Android puede llegar en segundo plano y el ahorro de batería puede retrasarlo. Los recordatorios son puntuales por tarea y dispositivo. Al pulsar el aviso se abre la tarea.

En **Eventos**, crea una cita repetible con un inicio próximo y elige un **Recordatorio**. Usa **Permitir avisos en este dispositivo** si aparece. Desplaza una ocurrencia desde el calendario, cancela otra y corta la serie desde una tercera. Comprueba que se programa el nuevo aviso de la primera y se retiran los demás. Para probar una excepción al recordatorio, edita **Solo este evento** y elige **Sin recordatorio**. Un evento de día completo toma como referencia las 09:00 del primer día en la zona local.

En la PWA con push activo, repite la prueba con la app cerrada después de que se hayan sincronizado los avisos. El texto del aviso es genérico. Al pulsarlo, la PWA abre la ocurrencia si sigue disponible. La ventana de programación de 30 días se renueva con la app en marcha. Si mueves o cancelas el evento desde otro dispositivo, el cambio se aplica cuando sincroniza el dispositivo que tenía programado el aviso.

### Avisos push con la app cerrada (PWA en Android e iOS)

Los avisos push permiten que la PWA reciba recordatorios cerrada en Android (Chrome, Edge, Firefox), en escritorio y en iPhone o iPad con iOS/iPadOS 16.4 o posterior. En iOS solo funcionan desde la app añadida a la pantalla de inicio. Las apps de Windows (Tauri) y Android (Capacitor) siguen usando sus avisos nativos.

El servidor guarda la suscripción push de cada dispositivo y la hora de cada recordatorio con un identificador aleatorio. No recibe el título ni el identificador de la tarea. El aviso muestra el texto genérico de siempre. Se activan por dispositivo y requieren la sesión iniciada en **Cuenta**, sin necesidad de desbloquear el cifrado. Para mantener la lista del servidor al día, marca **Mantener sesión iniciada**.

#### Desplegar en Supabase

Se hace una vez por proyecto Supabase, que ya debe tener aplicadas las migraciones de la Fase 3. Los comandos se ejecutan desde la raíz del repositorio y funcionan en la terminal de macOS (zsh) y en PowerShell, salvo donde se indica. La [CLI de Supabase](https://supabase.com/docs/guides/local-development/cli/getting-started) se usa con `npx supabase` sin instalar nada. También puedes instalarla con `brew install supabase/tap/supabase` en macOS o `scoop install supabase` en Windows y escribir `supabase` en lugar de `npx supabase`. La CI no necesita nada de esto: solo comprueba, prueba y compila el código, igual que antes.

1. Inicia sesión y enlaza el proyecto. El `ref` es el subdominio de `https://<ref>.supabase.co`:

   ```sh
   npx supabase login
   npx supabase link --project-ref <ref>
   ```

2. Aplica `supabase/migrations/202611240001_push_reminders.sql` desde **SQL Editor**. No uses `supabase db push`: las migraciones anteriores se aplicaron a mano y la CLI intentaría ejecutarlas otra vez. Comprueba en **Table Editor** que existen `push_subscriptions` y `push_reminders`.

3. Genera las claves VAPID y el secreto del cron:

   ```sh
   node supabase/generate-push-keys.mjs > supabase/functions/.env
   ```

   En Windows PowerShell 5.1, `>` guarda el archivo en UTF-16 y la CLI no lo lee bien. Usa en su lugar `node supabase/generate-push-keys.mjs | Set-Content -Encoding ascii supabase/functions/.env`.

   Abre `supabase/functions/.env` y completa la última línea con un contacto, por ejemplo `ORGANIFY_VAPID_SUBJECT=mailto:avisos@ejemplo.com`. Apple rechaza los avisos sin él. El archivo está en `.gitignore`. Guarda una copia segura: si cambias las claves, cada dispositivo se vuelve a suscribir al abrir la app.

4. Sube los secretos y despliega la función sin verificación de JWT. El `GET` solo devuelve la clave pública y el `POST` comprueba el secreto del cron por su cuenta. Si la CLI pide Docker para empaquetar la función, añade `--use-api`:

   ```sh
   npx supabase secrets set --env-file supabase/functions/.env
   npx supabase functions deploy organify-push --no-verify-jwt
   ```

   Comprueba la función. En PowerShell, escribe `curl.exe` en lugar de `curl`:

   ```sh
   curl https://<ref>.supabase.co/functions/v1/organify-push
   # {"publicKey":"B..."}
   curl -i -X POST https://<ref>.supabase.co/functions/v1/organify-push
   # HTTP/2 401: falta el secreto del cron
   ```

5. Copia `supabase/push-schedule.sql`, sustituye la URL de la función y el valor de `ORGANIFY_PUSH_CRON_SECRET` y ejecútalo en **SQL Editor**. No guardes en Git la copia con los valores reales. Si no se pueden crear las extensiones, activa `pg_cron` y `pg_net` en **Database → Extensions** y vuelve a ejecutarlo. Al cabo de dos minutos, comprueba que el cron funciona:

   ```sql
   select status, return_message, start_time
   from cron.job_run_details order by start_time desc limit 5;

   select status_code, content
   from net._http_response order by created desc limit 5;
   ```

   Debe aparecer `succeeded` y respuestas `200` con `{"processed":0}`. Un `401` indica que el secreto del cron no coincide con el de la función. Para repetir el script, borra antes lo creado, porque Vault no admite nombres repetidos:

   ```sql
   select cron.unschedule('organify-push-reminders');
   delete from vault.secrets where name in ('organify_push_url', 'organify_push_cron_secret');
   ```

6. Despliega `apps/web/dist` por HTTPS, o el ZIP del workflow **Publicar PWA**. No necesita variables nuevas.

#### Probar los avisos push

Activa los avisos en cada dispositivo:

- **Android y escritorio:** inicia sesión en **Cuenta** con **Mantener sesión iniciada**, marca **Ajustes → General → Recibir recordatorios con la app cerrada** y concede el permiso.
- **iPhone y iPad (iOS 16.4 o posterior):** abre la web en Safari y toca **Compartir → Añadir a pantalla de inicio**. Abre la app desde el icono, inicia sesión y activa la casilla. Desde Safari sin instalar, la casilla aparece desactivada.

Programa un recordatorio dentro de dos o tres minutos y cierra la app por completo. El aviso debe llegar en el minuto siguiente a la hora elegida. Al pulsarlo se abre la tarea. Si la app sigue abierta, el aviso local retira el recordatorio del servidor. Si ambos coinciden en el mismo minuto, comparten etiqueta y el segundo sustituye al primero sin volver a sonar. Desactiva la casilla o cierra sesión para retirar la suscripción del servidor.

Si no llega:

- En **Edge Functions → organify-push → Logs**, comprueba si el servicio push rechazó el envío y con qué código.
- Desde **SQL Editor**, comprueba que el recordatorio está en `push_reminders`.
- En Android, revisa el permiso de notificaciones del navegador y el ahorro de batería.

En Chrome de escritorio puedes probar el service worker sin servidor desde **DevTools → Application → Service workers → Push**: debe aparecer el aviso genérico.

#### Desactivar los avisos push

Para dejar de enviar avisos, ejecuta `select cron.unschedule('organify-push-reminders');`. La app sigue funcionando y los recordatorios vuelven a ser solo locales. Para retirarlo todo, borra también la función desde el panel y las tablas `push_reminders` y `push_subscriptions`.

### Probar las ventanas independientes de Windows

Abre dos tareas con **Abrir en ventana** desde la lista o desde el detalle. Edita una tarea en su ventana y comprueba el cambio en la lista principal. Prueba también el botón desde **Tablero** y **Calendario** con un proyecto seleccionado. El Calendario independiente abre en la fecha y vista que estabas consultando.

Pulsa **Minimizar a la bandeja del sistema** y comprueba que la ventana principal desaparece de la barra de tareas. Busca el icono de Organify en el área de notificación de Windows, también accesible desde **Mostrar iconos ocultos**. Comprueba que puedes restaurar la ventana con un clic en el icono o con **Abrir Organify** en su menú contextual.

En una instalación de Windows, programa un recordatorio y activa **Ocultar en la bandeja al cerrar y seguir recibiendo recordatorios** en **Ajustes**. Cierra la ventana principal con la X y comprueba que el aviso aparece mientras está oculta. Prueba que **Salir de Organify** en el menú de la bandeja cierra la app, incluidas sus ventanas independientes. Desactiva el ajuste de bandeja y comprueba que la X vuelve a cerrar la app.

Activa **Iniciar con la ventana maximizada** y vuelve a abrir Organify. Activa **Abrir las tareas en ventanas independientes** y prueba a abrir una tarea desde la lista, el tablero y el calendario. Usa el atajo de edición y crea una tarea desde la captura rápida para comprobar que el editor abre en su propia ventana.

En **Ajustes → General**, selecciona otra **Vista predeterminada** y vuelve a abrir la app. Comprueba que **Ocultar los iconos de estado de las tareas** oculta las marcas en lista y tablero, y que cambiar el **Tamaño de letra** se aplica en Windows y web al instante y tras volver a abrir la app.

## Probar Rutinas

- Crea una rutina semanal de dos pasos y márcalos desde **Hoy** y desde el detalle en **Rutinas**. Comprueba que la racha sube una vez y vuelve al valor anterior al desmarcar un paso.
- Cambia los pasos o la frecuencia y comprueba que la checklist actual se mantiene hasta cerrar el ciclo. La pausa y la reanudación también se aplican al próximo ciclo.
- Con la misma cuenta en dos dispositivos, sincroniza la rutina, desconecta ambos y marca un paso distinto en cada uno. Al reconectar, deben verse ambos pasos y una sola finalización del ciclo.
- Sincroniza una cuenta de prueba que tenga rutinas con un cliente 0.9.0 y crea una tarea en ese cliente. Comprueba que la tarea llega a la 0.10.0. Actualiza el cliente 0.9.0 y comprueba que aparecen las rutinas y sus marcas.

## Espacios compartidos

Aplica `supabase/migrations/202611250001_shared_workspaces.sql` desde **SQL Editor** tras las migraciones anteriores. Usa un proyecto de Supabase de pruebas y dos cuentas con el correo confirmado para probar la colaboración.

1. Desde **Cuenta**, conecta ambas cuentas al mismo proyecto y desbloquea el cifrado en dos perfiles de navegador distintos.
2. En el primer perfil, abre **Espacios compartidos → Crear espacio**. Crea un proyecto y una tarea con descripción dentro del espacio nuevo. Abre de nuevo **Espacios compartidos → Gestionar acceso** y genera una invitación para el correo de la segunda cuenta.
3. Comparte el código por un canal privado y pégalo en **Espacios compartidos → Aceptar invitación** desde la segunda cuenta. Comprueba que aparecen el proyecto, la tarea y la descripción. El código está ligado al correo, dura 48 horas y se consume al aceptarlo. Generar otro código para el mismo correo invalida el anterior.
4. Con los dos perfiles abiertos en el espacio compartido, desconecta ambos, cambia el título en uno y el estado en el otro. Al reconectar, comprueba que ambos cambios llegan y que **Personal** conserva sus propios proyectos y tareas. Prueba también la sincronización de **Personal** entre clientes 0.15.x y 0.16.0.
5. Retira el acceso de la segunda cuenta desde **Gestionar acceso**. Comprueba que el espacio deja de aparecer en esa cuenta cuando vuelve a contactar con el servidor. Si la vuelves a invitar, comprueba que los cambios pendientes de su alta anterior no se reenvían.

Los espacios compartidos incluyen proyectos, tareas, descripciones en bloques, rutinas y eventos. Los recordatorios y las ventanas independientes se usan desde **Personal**. Para recuperar los espacios compartidos después de recargar, inicia sesión y desbloquea el cifrado con conexión. Una vez abierto el espacio, puedes seguir editándolo sin conexión.

Desde un proyecto compartido, abre **Rutinas** y crea una rutina de dos pasos. En **Eventos**, crea una serie repetible. Comprueba que también aparecen en las secciones generales del espacio. Con ambos perfiles desconectados, marca un paso distinto en cada uno y modifica una ocurrencia en uno de ellos. Al reconectar, comprueba que ambos perfiles ven la checklist completa y la excepción del evento. En **Editar → Todos los eventos**, cambia el proyecto de la serie y comprueba que se conservan los tramos y sus excepciones. Al seleccionar **Sin proyecto**, la serie sigue disponible en la sección general del espacio.

Supabase guarda el correo de invitación, la pertenencia al espacio y los registros cifrados. El nombre, el contenido y la clave del espacio se cifran en cliente. La parte del código que abre la clave se comparte directamente con la persona invitada. Al retirar un miembro, Supabase corta su acceso al historial y a las nuevas escrituras. El dispositivo del miembro puede conservar los datos ya descargados y esta versión mantiene la misma clave de espacio.

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

## Inicio y creación de proyectos (0.17.0)

- Desde el `+` junto a **Proyectos** en el sidebar o **Añadir proyecto** en Inicio, crea un proyecto con título y color. Comprueba que no admite un título vacío, que Cancelar y Escape cierran sin crear y que el color se conserva al recargar y sincronizar. Repite desde el menú móvil y en un espacio compartido.
- Colapsa el sidebar en escritorio y pulsa el extremo izquierdo a distintas alturas para volver a abrirlo.
- En Inicio, abre **Preferencias** de cada sección y elige de una a cinco filas o **Sin límite**. Comprueba que espacios y proyectos conservan ajustes independientes al recargar y al cambiar el ancho de la ventana. **Ver todos** permite consultar las tarjetas restantes sin cambiar la preferencia. Cierra el desplegable pulsando fuera o con Escape.
- En **Tu panel personal**, comprueba que **Personalizar** muestra el pincel y sigue permitiendo elegir módulos.

- En las ventanas modales, pulsa fuera para cerrarlas igual que con Escape. Comprueba que pulsar su relleno interior o arrastrar desde dentro hacia fuera no las cierra, y que respetan el bloqueo de cierre mientras guardan o borran.
