# Versionado de Organify

La versión visible de la app (por ejemplo, 0.4.0) identifica la publicación. El protocolo de sincronización identifica el formato y significado de las operaciones que pueden intercambiar los clientes. Mantén alineadas las versiones de los paquetes de web, escritorio y móvil, la configuración de Tauri, el paquete Rust y el historial de versiones. Para distribuir en Android, actualiza también `versionName` y aumenta `versionCode` en el proyecto nativo generado.

## Cambios de sincronización

- La 0.7.0 conserva el protocolo 1 y sincroniza con los clientes anteriores. Mantener la sesión iniciada guarda los tokens de Supabase en el dispositivo. El desbloqueo opcional usa IndexedDB en una base independiente de la de tareas y protege la clave maestra con una clave no exportable de Web Crypto. El formato local tiene su propia versión. Se aplican las mismas migraciones de Supabase.
- La 0.5.1 conserva el protocolo 1 y envía su cabecera solo en las RPC de sincronización. Comparte servidor e historial cifrado con la 0.5.0 y requiere las mismas migraciones de Supabase.
- La 0.5.0 conserva el protocolo 1. El nombre y el color de proyecto usan operaciones de campo independientes. Los clientes anteriores conservan el color en la réplica y pueden seguir sincronizando tareas. Al actualizar a la 0.5.0, Dexie recupera los colores ya recibidos.
- La 0.4.0 anuncia el protocolo 1 desde `packages/sync/src/supabase.ts`. Los clientes anteriores que omiten la cabecera también se tratan como protocolo 1. Supabase aplica el rango admitido al conectar y en cada llamada a las RPC de envío y descarga.
- Antes de cambiar el protocolo, revisa las operaciones pendientes, las operaciones cifradas del historial, el formato de las claves y las migraciones de IndexedDB. Comprueba qué pasa si dispositivos antiguos y nuevos trabajan sin conexión y vuelven en distinto orden. La cabecera describe el cliente y no convierte los datos cifrados. Una versión nueva debe poder leer el historial previo o incluir una estrategia explícita para migrarlo.
- Si el cambio es compatible, conserva el protocolo. Si es incompatible, añade una migración de Supabase que actualice el rango de protocolos admitidos. Mantén ambos durante la transición solo si los clientes pueden intercambiar operaciones de forma segura. Si no pueden, distribuye primero una versión que pueda leer los datos antiguos y coordina el bloqueo de los clientes anteriores antes de habilitar operaciones incompatibles.
- Aplica las migraciones nuevas en orden. Para la 0.4.0, aplica `202611160001_sync_protocol.sql` antes de distribuir el cliente. Verifica conexión, subida y descarga con 0.3.0 y 0.4.0, el rechazo de un protocolo fuera de rango y la conservación de los cambios locales al quedar bloqueado.

## Actualizaciones de Windows

La comprobación se activa en compilaciones de producción que incluyan la configuración `plugins.updater`. Al arrancar, Tauri consulta el manifiesto, verifica la firma del instalador y lo instala si hay una versión más reciente. Windows cierra la aplicación durante la instalación. Si la comprobación falla, se puede seguir usando la app.

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
