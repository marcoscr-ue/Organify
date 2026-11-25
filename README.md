# Organify

Organify es una aplicación personal para organizar tareas y proyectos. Puedes ver las mismas tareas en una lista, un tablero Kanban o un calendario, y guardar notas en bloques dentro de cada tarea.

La app funciona sin conexión y guarda los datos en el dispositivo. Si quieres usar tus tareas en varios dispositivos, puedes configurar la sincronización con Supabase. El contenido se cifra de extremo a extremo al sincronizar.

## Descargar Organify

Abre [GitHub Releases](https://github.com/marcoscr-ue/Organify/releases), elige la versión que quieras instalar y despliega **Assets**. Los archivos disponibles pueden variar según la versión.

| Plataforma | Archivo                | Qué hacer                                                                                                                                                                   |
| ---------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows    | Instalador `.exe`      | Descárgalo, ábrelo y sigue los pasos del instalador.                                                                                                                        |
| Android    | `Organify-android.apk` | Descárgalo en el móvil y ábrelo para instalarlo. Android puede pedirte permiso para instalar apps desde el navegador o el gestor de archivos.                               |
| Web (PWA)  | `Organify-PWA.zip`     | Si quieres alojar la versión web, descomprime el ZIP y publica su contenido en un alojamiento estático con HTTPS. Desde un navegador compatible puedes instalarla como app. |

## Ejecutar y modificar el código

Con [Git](https://git-scm.com/) y [Node.js 24](https://nodejs.org/) instalados, ejecuta estos comandos en una terminal:

```sh
git clone https://github.com/marcoscr-ue/Organify.git
cd Organify
corepack pnpm install
corepack pnpm dev
```

Abre la URL que muestra Vite, normalmente `http://localhost:5173`. Puedes probar la app sin cuenta ni configuración de Supabase. La interfaz está en [apps/web/src](apps/web/src) y el código compartido en [packages](packages). Si quieres partir del código en desarrollo, cambia a la rama `dev` antes de instalar las dependencias.

También puedes bajar una copia desde **Code → Download ZIP** en GitHub. Descomprime el archivo, abre una terminal en esa carpeta y ejecuta los dos comandos de `corepack`.

## Documentación

- [Notas de desarrollo](docs/DEVNOTES.md) para preparar el entorno, ejecutar las comprobaciones, configurar Supabase y compilar o publicar cada plataforma.
- [Diseño y arquitectura](docs/PROYECTO.md) para conocer la estructura y las decisiones del proyecto.
- [Versionado y compatibilidad](docs/VERSIONADO.md) para preparar releases y cambios en la sincronización.
- [Diseño de Eventos](docs/EVENTS_0-15.md) para consultar cómo funcionan las series, las excepciones y los recordatorios.
