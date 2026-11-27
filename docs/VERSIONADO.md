# Versionado de Organify

El protocolo de sincronización identifica el formato y significado de las operaciones que pueden intercambiar los clientes. En una release multiplataforma, alinea las versiones de los paquetes web, escritorio y móvil, Tauri, Cargo y el historial. Para distribuir en Android, actualiza también `versionName` y aumenta `versionCode` en el proyecto nativo generado.

Los parches exclusivos de Windows pueden avanzar la versión técnica de escritorio. `Rust++0.7.0++a` se publica como `v0.7.1`, con `0.7.1` en Tauri, Cargo y el manifiesto de actualización. Android y PWA siguen en `0.7.0`. La release de Windows conserva el manifiesto de Android de la última release estable para mantener el mismo APK disponible.

## Cambios de sincronización

- La 0.17.0 incorpora Inicio y su panel personalizable. Las preferencias del panel se guardan en el dispositivo. Los clientes anteriores y nuevos pueden seguir intercambiando las operaciones guardadas y las nuevas con el protocolo 1, los esquemas de IndexedDB y las RPC existentes. Se aplican las mismas migraciones de Supabase que en la 0.16.1. El APK de distribución usa `versionName` 0.17.0 y `versionCode` 17000.

- La 0.16.1 habilita las operaciones existentes de rutinas y eventos en el historial de los espacios compartidos. El proyecto opcional se sincroniza en `routine:projectId` o `event:projectId`, con `null` para quitar el vínculo. El campo del evento se guarda en la raíz y se aplica a toda la serie, incluidos los tramos existentes y futuros. Los clientes 0.16.0 conservan las operaciones compartidas al sincronizar y las muestran después de actualizar. Las versiones anteriores conservan los vínculos del historial personal y pueden seguir editando los campos que conocen. Se mantienen el protocolo 1, los esquemas de IndexedDB y las RPC. Los espacios compartidos usan la misma migración de Supabase que la 0.16.0. El APK de distribución usa `versionName` 0.16.1 y `versionCode` 16001.

- La 0.16.0 presenta los datos existentes dentro del espacio Personal. Mantiene su base local, las operaciones del protocolo 1, la clave de cuenta y las RPC anteriores. Los clientes 0.15.x y 0.16.0 pueden seguir editando y sincronizando los mismos datos personales, incluidas las operaciones pendientes antes de actualizar.
- Los espacios compartidos usan un historial independiente por espacio y nuevas RPC en `202611250001_shared_workspaces.sql`. Reutilizan el formato de operaciones 1 con un contexto de cifrado y una clave propios. Cada alta de un miembro tiene una base IndexedDB independiente en su navegador, con su propio cursor y cola. Las versiones anteriores siguen usando el historial personal y no pueden abrir los espacios compartidos. Aplica esta migración en Supabase antes de habilitar la colaboración y distribuye 0.16.0 a las cuentas que participen. En Android la compilación de distribución usa `versionName` 0.16.0 y `versionCode` 16000.

- La 0.15.4 sincroniza el adelanto del recordatorio en `event:reminderMinutes`, en la definición de cada tramo y como campo de excepción. Los clientes anteriores siguen sincronizando los eventos y las tareas. La 0.15.3 conserva el campo al editar los tramos que mantiene, y una sustitución de programación en esa versión puede perder el ajuste específico del tramo sustituido. Los avisos de eventos programados en el dispositivo usan su propia clave de `localStorage`. Los avisos push siguen usando la suscripción existente y enviando al servidor solo la hora y un identificador aleatorio por aviso. Se mantienen el protocolo 1, IndexedDB y las RPC de Supabase. El APK de distribución usa `versionName` 0.15.4 y `versionCode` 15004.

- La 0.15.3 usa `event:segments` para editar la serie completa. Al cambiar la programación, cada tramo puede guardar referencias a los campos de las excepciones que conservan su inicio previsto. La 0.15.2 muestra la nueva programación y sus excepciones del espacio activo. Las excepciones heredadas se vuelven a aplicar al actualizar a la 0.15.3. El borrado de toda la serie usa `event:removed`, reconocido desde la 0.15.0, y prevalece sobre las ediciones de sus tramos. Se mantienen el protocolo 1, IndexedDB y las RPC de Supabase. El APK de distribución usa `versionName` 0.15.3 y `versionCode` 15003.

- La 0.15.2 guarda los tramos activos de cada grupo en el campo `event:segments` de su réplica. Dos cambios concurrentes sobre el futuro del mismo grupo se resuelven mediante el orden de operaciones existente (HLC, dispositivo e identificador). Se aplica la programación completa de la operación ganadora. Los cambios de título, notas o color mantienen la asociación con las excepciones. Una programación nueva abre su propio espacio de excepciones mediante campos `event:occurrence/<origen-del-tramo>/<inicio-original>/<campo>`. La 0.15.0 y la 0.15.1 siguen mostrando la programación original. La 0.15.1 aplica sus excepciones previas y las que se sigan guardando en el origen inicial. Los clientes 0.14 a 0.15.1 conservan los campos nuevos y pueden reconstruir los tramos al actualizar. Se mantienen el protocolo 1, IndexedDB y las RPC de Supabase. El APK de distribución usa `versionName` 0.15.2 y `versionCode` 15002.

- La 0.15.1 guarda los cambios puntuales de una serie en campos `event:occurrence/<inicio-original>/<campo>` de la réplica del tramo. El horario se sincroniza como un campo y una cancelación prevalece sobre las ediciones de esa ocurrencia. Se mantienen el protocolo 1, IndexedDB y las RPC de Supabase. La 0.15.0 sigue mostrando la serie según su regla original, conserva los campos nuevos y aplica las excepciones al actualizar. La 0.14 los conserva en el diario junto con los demás datos de eventos. El APK de distribución usa `versionName` 0.15.1 y `versionCode` 15001.

- La 0.15.0 guarda eventos en el diario mediante operaciones de campo `item` del protocolo 1, con identificadores `event/<uuid>` y campos `event:*`. El inicio, el fin, la zona y la repetición se guardan juntos para mantener una programación coherente al sincronizar. Los clientes 0.14 conservan las operaciones en sus réplicas, siguen intercambiando tareas y muestran los eventos guardados cuando se actualizan. El esquema de IndexedDB y las RPC de Supabase se mantienen. Para esta versión, Android usa `versionName` 0.15.0 y `versionCode` 15000 al generar el APK de distribución.

- La 0.14.0 guarda las nuevas preferencias en el dispositivo. Los clientes anteriores y nuevos siguen intercambiando operaciones con el protocolo 1 y las migraciones de Supabase existentes para sincronizar datos.
- Los avisos push de la PWA no cambian el protocolo 1, las operaciones, el esquema de IndexedDB ni las RPC de sincronización. La migración `202611240001_push_reminders.sql` añade tablas y RPC independientes (`organify_push_*`). Para entregar avisos, despliega también la función `organify-push` y programa su ejecución periódica. El cliente puede distribuirse antes de configurar este servicio y el resto de la app sigue funcionando. Los clientes anteriores no usan estas tablas. Los recordatorios locales añaden los campos opcionales `key` y `delivered` en `localStorage`. Los recordatorios guardados por versiones anteriores reciben un `key` al activar los avisos push. Si se vuelve a una versión anterior en el mismo navegador, cada aviso ya entregado puede mostrarse una vez más.

- La 0.13.0 guarda la duración estimada y el tiempo empleado con dos operaciones de propiedad de tarea independientes (`prop:estimatedMinutes` y `prop:spentMinutes`). Los clientes anteriores ya conservan estas propiedades en las tareas y pueden seguir editando y sincronizando los campos que conocen. La vista En curso se calcula en cliente. Se mantienen el protocolo 1, el esquema de IndexedDB y las migraciones de Supabase.

- La 0.10.0 conserva el protocolo 1 y el esquema de IndexedDB. Rutinas guarda cambios cifrados con operaciones de campo `item` sobre identificadores reservados `routine/<uuid>`, con un campo independiente por ciclo y paso. Los clientes anteriores conservan estas operaciones en el diario y siguen sincronizando tareas y proyectos. Tras actualizar, el cliente reconstruye las rutinas a partir del diario local, incluso si esas operaciones se descargaron antes de actualizar. Se aplican las mismas migraciones de Supabase.

- La 0.9.0 conserva el protocolo 1. El borrado múltiple registra una operación de borrado existente por tarea en una transacción local. Los clientes anteriores pueden aplicar esas operaciones con las mismas migraciones de Supabase.
- La 0.8.0 conserva el protocolo 1 y sigue intercambiando operaciones con la 0.7.x. Los cambios del editor usan las operaciones de campo y de descripción existentes. Se aplican las mismas migraciones de Supabase.

- La 0.7.0 conserva el protocolo 1 y sincroniza con los clientes anteriores. Mantener la sesión iniciada guarda los tokens de Supabase en el dispositivo. El desbloqueo opcional usa IndexedDB en una base independiente de la de tareas y protege la clave maestra con una clave no exportable de Web Crypto. El formato local tiene su propia versión. Se aplican las mismas migraciones de Supabase.
- La 0.5.1 conserva el protocolo 1 y envía su cabecera solo en las RPC de sincronización. Comparte servidor e historial cifrado con la 0.5.0 y requiere las mismas migraciones de Supabase.
- La 0.5.0 conserva el protocolo 1. El nombre y el color de proyecto usan operaciones de campo independientes. Los clientes anteriores conservan el color en la réplica y pueden seguir sincronizando tareas. Al actualizar a la 0.5.0, Dexie recupera los colores ya recibidos.
- La 0.4.0 anuncia el protocolo 1 desde `packages/sync/src/supabase.ts`. Los clientes anteriores que omiten la cabecera también se tratan como protocolo 1. Supabase aplica el rango admitido al conectar y en cada llamada a las RPC de envío y descarga.
- Antes de cambiar el protocolo, revisa las operaciones pendientes, las operaciones cifradas del historial, el formato de las claves y las migraciones de IndexedDB. Comprueba qué pasa si dispositivos antiguos y nuevos trabajan sin conexión y vuelven en distinto orden. La cabecera describe el cliente y no convierte los datos cifrados. Una versión nueva debe poder leer el historial previo o incluir una estrategia explícita para migrarlo.
- Si el cambio es compatible, conserva el protocolo. Si es incompatible, añade una migración de Supabase que actualice el rango de protocolos admitidos. Mantén ambos durante la transición solo si los clientes pueden intercambiar operaciones de forma segura. Si no pueden, distribuye primero una versión que pueda leer los datos antiguos y coordina el bloqueo de los clientes anteriores antes de habilitar operaciones incompatibles.
- Aplica las migraciones nuevas en orden. Para la 0.4.0, aplica `202611160001_sync_protocol.sql` antes de distribuir el cliente. Verifica conexión, subida y descarga con 0.3.0 y 0.4.0, el rechazo de un protocolo fuera de rango y la conservación de los cambios locales al quedar bloqueado.

## Actualizaciones de Windows

La comprobación se activa en compilaciones de producción que incluyan la configuración `plugins.updater`. Al arrancar, Tauri consulta el manifiesto, verifica la firma del instalador y lo instala si hay una versión más reciente. Windows cierra la aplicación durante la instalación. Si la comprobación falla, se puede seguir usando la app.

El canal experimental de Windows es opcional y se comprueba al activarlo y al arrancar. Usa el `latest.json` de la prerelease pública compatible de mayor versión, con la misma verificación de firma. Solo instala versiones superiores a la actual. Si al arrancar no hay una versión experimental aplicable, continúa la comprobación estable.

Cuando el instalador NSIS se ejecuta desde el actualizador, registra la versión instalada. Al arrancar esa versión, Organify muestra sus notas de lanzamiento y borra el aviso al cerrar la ventana. El historial completo sigue disponible en el botón de versión.

1. Genera una pareja de claves con `corepack pnpm --filter @organify/desktop exec tauri signer generate -w <ruta-fuera-del-repositorio>`. Guarda una copia segura de la clave privada. Las instalaciones existentes confían en la clave pública incluida en su compilación.
2. Configura las variables del repositorio `TAURI_UPDATER_PUBLIC_KEY` (contenido de la clave pública) y `TAURI_UPDATER_ENDPOINT` (URL HTTPS del manifiesto). Para un repositorio público puedes usar `https://github.com/OWNER/REPO/releases/latest/download/latest.json`. Si el repositorio es privado, sirve el manifiesto y el instalador firmado desde un endpoint accesible para los clientes y ajusta la URL del instalador en el manifiesto que publiques.
3. Guarda el contenido de la clave privada en el secreto `TAURI_SIGNING_PRIVATE_KEY` y su contraseña en `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Configura las variables `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` para que la compilación distribuida incluya la sincronización.
4. Ejecuta manualmente el workflow **Publicar Windows** desde la rama de la versión. Revisa y publica el borrador de GitHub Release. Para verificar el ciclo completo, instala una compilación firmada anterior y comprueba que al abrirla instala la siguiente. Las instalaciones de 0.3.0 requieren instalar manualmente la primera versión con el actualizador.

## Actualizaciones de Android por APK

Al arrancar, Organify consulta un manifiesto HTTPS en segundo plano y compara su `versionCode` con el del APK instalado. Si hay una versión más reciente, **Descargar APK** abre el enlace en el navegador. Después, el usuario abre el archivo descargado y confirma la instalación en Android. Si Android lo pide, permite que el navegador o gestor de archivos instale desde esa fuente. El aviso se puede posponer y la app sigue disponible si falla la conexión.

1. Publica un manifiesto JSON en una URL HTTPS estable. Usa ese enlace al preparar el proyecto nativo desde PowerShell:

   ```powershell
   $env:ORGANIFY_ANDROID_UPDATER_ENDPOINT = 'https://descargas.example.com/organify/android.json'
   corepack pnpm --filter @organify/mobile android:sync
   ```

   Si aún no tienes el proyecto nativo, ejecuta primero `android:add`. Define la variable en cada sesión de compilación que ejecute `android:add` o `android:sync`. Si está vacía, el APK se compila sin comprobación de actualizaciones.

2. Genera un APK de distribución firmado en Android Studio. Conserva el identificador `app.organify.personal` y la clave con la que firmaste la versión anterior. Incrementa el `versionCode` en `apps/mobile/android/app/build.gradle` y actualiza `versionName`.
3. Sube primero el APK firmado a HTTPS. Después publica el manifiesto con el código real del APK y su URL directa. Por ejemplo:

   ```json
   {
     "applicationId": "app.organify.personal",
     "versionCode": 2,
     "apkUrl": "https://descargas.example.com/organify/Organify-0.4.1.apk"
   }
   ```

4. Instala manualmente el primer APK con actualizador. Para comprobar el flujo, publica un segundo APK con la misma firma y un código superior, abre la primera versión e instala desde el aviso. Una instalación de depuración firmada con otra clave requiere una transición aparte. Antes de desinstalarla, conserva los datos locales que quieras mantener.

En web, despliega la nueva compilación y vuelve a abrir la PWA para cargarla. Android y web están sujetos a la misma comprobación de protocolo.
