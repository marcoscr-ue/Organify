# Organify: app personal de tareas (Calendar + Trello + Notion)

> Documento de contexto para trabajar con una IA desde cero.

## 1. Objetivo

App personal para organizar tareas que mezcla:
- **Calendario** (items con fecha, arrastrar para reprogramar, recurrencias).
- **Tablero tipo Trello** (columnas por estado, drag & drop).
- **Notas tipo Notion** (cuerpo en bloques dentro de cada tarea).

Plataformas: **PC y móvil** como prioridad, **web** como puerta abierta (y de hecho es la base de todo).
Uso personal y colaboración en proyectos y tareas desde la v0.16.
Requisitos duros: **offline-first**, **sincronización entre dispositivos**, **cifrado de extremo a extremo (E2EE)**.

Perfil del desarrollador: conocimientos amplios de programación e informática. Se trabaja "vibecoding" con IA: pasos pequeños, verificables, con tests.

## 2. Decisiones de stack

| Capa | Elección | Notas |
|---|---|---|
| Lenguaje | **TypeScript** en todo | Monorepo con **pnpm** workspaces |
| UI | **React + Vite** | Tailwind + shadcn/ui (Radix) |
| Estado | **Zustand** + consultas reactivas sobre la BD local | |
| Almacenamiento local | **IndexedDB vía Dexie** (MVP) | Funciona igual en web, Tauri y Capacitor. Detrás de una interfaz de repositorio para poder cambiar a SQLite más adelante |
| Kanban / DnD | **dnd-kit** | |
| Calendario | **FullCalendar** (decidido) | Usar los plugins MIT (`daygrid`, `timegrid`, `list`, `interaction`); evitar los premium. Recurrencias con `rrule`. Encapsularlo detrás de un componente propio `<CalendarView>` por si algún día se sustituye |
| Captura rápida | **chrono-node** | "reunión con Ana mañana 10h" |
| Notas en bloques | **TipTap** (ProseMirror) + **Yjs** (decidido) | CRDT para texto largo. Usar la extensión open source de colaboración con Yjs, sin Tiptap Cloud (los updates de Yjs viajan cifrados por nuestro propio sync). Comprobar en la documentación qué extensiones son de pago antes de depender de ellas |
| Búsqueda | **MiniSearch / FlexSearch** local | Con E2EE la búsqueda es solo en cliente |
| Cripto | **libsodium** (`libsodium-wrappers-sumo`) | XChaCha20-Poly1305, Argon2id, X25519 |
| Backend de sync | **Supabase** (Auth + Postgres + Realtime) como *almacén tonto de datos cifrados* | Intercambiable vía `SyncAdapter` |
| Escritorio | **Tauri 2** | Fase tardía |
| Móvil | **Capacitor, solo Android** | Fase tardía. iOS descartado por ahora (la PWA cubre iPhone si algún día hiciera falta) |
| Web | **PWA** instalable | Es la app base |
| Tests | **Vitest** (unidad), **Playwright** (e2e) | |

Regla de oro: **primero funciona como web/PWA; Tauri y Capacitor son solo "envoltorios"**.

## 3. Arquitectura

```
┌──────────── Cliente (web / Tauri / Capacitor) ────────────┐
│ UI React                                                   │
│   └─ Repositorios (ItemRepo, ProjectRepo, DocRepo...)      │
│        └─ BD local (Dexie)  ◄── fuente de verdad de la UI  │
│        └─ Outbox de cambios pendientes                     │
│ SyncEngine ─ cifra/descifra ─ SyncAdapter (pull/push)      │
└──────────────────────────────┬─────────────────────────────┘
                               │ solo bytes cifrados
                      ┌────────▼────────┐
                      │ Supabase        │  Auth + tabla `changes`
                      └─────────────────┘
```

Principios:
1. La UI **solo lee y escribe en la BD local**. Nunca espera a la red.
2. El `SyncEngine` corre en segundo plano: empuja la outbox y trae cambios nuevos.
3. El servidor **no entiende los datos**: guarda un log de cambios cifrados. No puede filtrar, buscar ni validar contenido.
4. `SyncAdapter` es una interfaz (`push(changes)`, `pull(cursor)`, `subscribe(cb)`); el proveedor es sustituible.

## 4. Modelo de datos (local)

Todo es una entidad con **UUIDv7/ULID generado en cliente**.

```ts
type Id = string; // UUIDv7

interface Item {
  id: Id;
  title: string;
  status: string;            // 'todo' | 'doing' | 'done' | personalizado
  start?: string;            // ISO
  due?: string;              // ISO
  allDay?: boolean;
  recurrence?: string;       // RRULE
  priority?: 0 | 1 | 2 | 3;
  projectId?: Id;
  parentId?: Id;             // subtareas
  order: string;             // fractional indexing (LexoRank-like) para ordenar sin reescribir todo
  tagIds: Id[];
  props: Record<string, unknown>; // propiedades personalizadas (fase 5)
  docId?: Id;                // cuerpo en bloques (Yjs)
  deletedAt?: string;        // borrado lógico
}

interface Project { id: Id; name: string; color?: string; order: string; archived?: boolean; deletedAt?: string }
interface Tag     { id: Id; name: string; color?: string; deletedAt?: string }
interface View    { id: Id; name: string; type: 'list'|'board'|'calendar'; query: ViewQuery; deletedAt?: string }
interface Doc     { id: Id; yjsState: Uint8Array }   // contenido Notion-like
```

**Una sola fuente, varias vistas**: una tarea es un `Item`; calendario, tablero y lista son *consultas* distintas sobre los mismos items. Una `View` = filtro + orden + agrupación + tipo de render.

Convenciones:
- **Borrado lógico** siempre (`deletedAt`), nunca borrar físicamente (salvo compactación).
- **Orden** con *fractional indexing*, no con enteros.
- Fechas en ISO/UTC, con zona horaria del usuario solo para presentar.

## 5. Sincronización

### 5.1 Unidad de sincronización: la operación (op)
Cada modificación genera una op:

```ts
interface Op {
  id: Id;            // UUIDv7 de la op
  deviceId: string;
  hlc: string;       // Hybrid Logical Clock
  entity: 'item' | 'project' | 'tag' | 'view' | 'doc';
  entityId: Id;
  kind: 'set' | 'delete' | 'yjs-update';
  field?: string;    // para 'set': LWW por campo
  value?: unknown;
  yjsUpdate?: Uint8Array; // para docs
}
```

### 5.2 Resolución de conflictos
- **Propiedades de items/proyectos/etc.**: *last-write-wins por campo*, ordenando por **HLC** (no por reloj del dispositivo). Así cambiar el título en el PC y la fecha en el móvil no se pisa.
- **Notas (texto largo)**: **Yjs**. Las actualizaciones de Yjs viajan como ops cifradas.
- **Borrados**: op `delete` que pone `deletedAt`; gana si su HLC es mayor que el de cualquier edición posterior (decisión documentada en tests).

### 5.3 Servidor "tonto"
El historial personal usa la tabla `changes` en Postgres:

```sql
create table changes (
  seq        bigint generated always as identity primary key,
  user_id    uuid not null references auth.users(id),
  op_id      uuid not null unique,      -- idempotencia
  device_id  text not null,
  ciphertext bytea not null,            -- op cifrada
  created_at timestamptz not null default now()
);
alter table changes enable row level security;
-- RLS: user_id = auth.uid() para select/insert. Sin update ni delete.
```

- `pull(cursor)`: `select * from changes where seq > cursor order by seq`.
- `push`: insert idempotente por `op_id`.
- Realtime de Supabase solo para avisar "hay cambios nuevos".
- **Compactación (diferida, pero diseñada desde ya)**: ver sección 5.5.
- Metadatos que el servidor sí ve: tamaño, momento y dispositivo de cada cambio. Se asume.
- Con los avisos push activados en un dispositivo, el servidor también ve su suscripción push y la hora de cada recordatorio, con un identificador aleatorio sin relación con la tarea. Es opcional y se asume.

Los espacios compartidos tienen sus propios registros de cambios. Supabase autoriza la subida y la descarga según la pertenencia al espacio. En el dispositivo, cada alta en un espacio usa una base local con su propio cursor y su propia cola de cambios.

### 5.4 Estados a manejar
Offline prolongado, reintentos con backoff, ops duplicadas (idempotencia), orden de llegada distinto, dispositivo nuevo (descarga completa + descifrado), y reinstalación.

### 5.5 Estrategia de compactación del log (decisión: diferida, con puertas abiertas)
A escala personal el log es pequeño (del orden de miles de ops al año), así que **no se implementa hasta después de la Fase 4**. Pero se deja preparado:
- Cada op lleva un **campo de versión** (`v`) y el servidor tiene `seq` monotónico, de modo que añadir snapshots no requiere migrar nada.
- **Diseño futuro**: un dispositivo genera un **snapshot cifrado** del estado local completo en un `seq` concreto y lo sube a una tabla `snapshots(seq, user_id, ciphertext)`. Un dispositivo nuevo descarga el último snapshot y luego hace `pull(seq > snapshot.seq)`.
- Las ops con `seq <= snapshot.seq` solo se borran del servidor cuando todos los dispositivos conocidos han confirmado ese cursor (o tras un periodo de retención, p. ej. 30-60 días).
- Los docs Yjs se compactan con su propio mecanismo (estado codificado completo en lugar de updates incrementales).
- Los tombstones (`deletedAt`) pueden purgarse físicamente solo después de un snapshot que ya los incluya.
- **Disparador para implementarlo**: el pull inicial de un dispositivo nuevo tarda perceptiblemente (p. ej. más de unos segundos) o el log supera ~50.000 ops.

## 6. Cifrado E2EE

- **Clave maestra** aleatoria de 256 bits, generada en el primer dispositivo.
- La clave maestra se **envuelve** (cifra) con una clave derivada de la **contraseña/passphrase** del usuario mediante **Argon2id**; la versión envuelta puede guardarse en el servidor.
- **Clave de recuperación** (frase larga o QR) generada al registrarse, para poder recuperar la maestra si se olvida la passphrase. **Si se pierden ambas, los datos son irrecuperables.** Esto debe explicarse en la UI.
- Cifrado de ops: **XChaCha20-Poly1305** con nonce aleatorio. Los datos asociados incluyen la cuenta o el espacio compartido, la operación y el dispositivo.
- Auth de Supabase (email/contraseña o magic link) separada de la clave de cifrado: **la contraseña de login no debe ser la misma que deriva la clave**, o se deriva de forma independiente.
- Búsqueda y filtros **solo en cliente** (el servidor no ve nada).
- **Colaboración**. Cada espacio compartido tiene una clave aleatoria. Un código de un solo uso contiene el secreto que permite al invitado abrir esa clave. El servidor verifica una prueba derivada del código y el correo de la cuenta. Al aceptar, el invitado protege su copia de la clave con su clave de cuenta, lo que permite recuperarla en otros dispositivos.
- **Jerarquía**. Los proyectos pertenecen a un espacio. Las tareas, las rutinas y los eventos pueden vincularse a un proyecto del mismo espacio. Una serie de eventos comparte el vínculo de todos sus tramos. En un espacio compartido, el propietario gestiona el acceso y los miembros editan proyectos, tareas, rutinas y eventos. Los miembros de una rutina compartida trabajan sobre la misma checklist.
- Usa libsodium para las operaciones sincronizadas y las envolturas de cuenta. El desbloqueo recordado usa una clave no exportable de Web Crypto para proteger una copia local de la clave maestra.

## 7. UX / Diseño

**Escritorio**: sidebar (Hoy, Próximos, Proyectos, Vistas guardadas) · zona central con la vista activa · panel derecho con el detalle del item · **paleta de comandos Ctrl+K** · atajos de teclado.

**Móvil**: barra inferior (Hoy, Calendario, Boards, Buscar) · botón flotante de **captura rápida** · detalle como hoja inferior · board con columnas en scroll horizontal por swipe.

**Vistas**: Lista (Hoy / Próximos / Sin fecha / por proyecto), Board (agrupado por `status` u otra propiedad), Calendario (mes/semana/día, arrastrar para reprogramar).

**Principios**: responsive desde el día uno con un único sistema de componentes · tema claro/oscuro · la captura de una tarea debe ser instantánea (<2 interacciones).

## 8. Estructura del repositorio (propuesta)

```
/
├─ apps/
│  ├─ web/            # React + Vite (PWA)  ← aquí vive casi todo al inicio
│  ├─ desktop/        # Tauri (fase 4)
│  └─ mobile/         # Capacitor (fase 4)
├─ packages/
│  ├─ core/           # modelos, HLC, ops, merge LWW, lógica pura (sin UI ni red)
│  ├─ storage/        # repositorios + implementación Dexie
│  ├─ sync/           # SyncEngine + SyncAdapter + adaptador Supabase
│  ├─ crypto/         # libsodium: claves, cifrado, envoltura
│  └─ ui/             # componentes compartidos
├─ supabase/          # migraciones SQL, políticas RLS
├─ CLAUDE.md          # este documento resumido
└─ pnpm-workspace.yaml
```

`packages/core` debe ser **TypeScript puro y testeable** (sin DOM, sin red): es donde están los bugs difíciles (HLC, merge, recurrencias).

## 9. Plan por fases

**Fase 0 – Setup**: monorepo, TS estricto, ESLint/Prettier, Vitest, CI básica, Vite + Tailwind + shadcn.

**Fase 1 – MVP local (web)**: modelo `Item/Project`, repositorios sobre Dexie, vista Lista y Board con dnd-kit, detalle con notas simples, captura rápida con chrono-node, paleta de comandos. *Sin red todavía.*

**Fase 2 – Calendario**: vista mes/semana, arrastrar para reprogramar, recurrencias con `rrule`.

**Fase 3 – Núcleo de sync + cripto** (la fase delicada):
1. `core`: HLC + ops + merge LWW por campo, con tests exhaustivos (property-based si es posible).
2. `crypto`: clave maestra, Argon2id, cifrado de ops, recovery key.
3. `sync`: outbox, `SyncAdapter` en memoria (para tests con 2-3 "dispositivos" simulados).
4. Adaptador Supabase + auth + RLS.
5. Pruebas de caos: offline, ediciones concurrentes, duplicados, dispositivo nuevo.

**Fase 4 – Empaquetado**: PWA instalable → Tauri (PC) → Capacitor (solo Android). Notificaciones locales para recordatorios.

**Fase 5 – Notion-like**: editor de bloques completo (TipTap + Yjs cifrado), propiedades personalizadas, vistas guardadas.

**Fase 6 – Colaboración**. Espacios compartidos, claves por espacio e invitaciones en la v0.16.

## 10. Reglas de trabajo para la IA

- Trabaja en **pasos pequeños**; tras cada paso, indica cómo verificarlo (comando de test o qué mirar en la UI).
- **Tests primero o a la par** en `packages/core`, `crypto` y `sync`. No avanzar de fase con tests en rojo.
- **TypeScript estricto**, sin `any` salvo justificación comentada.
- La UI **nunca** habla directamente con la red ni con Dexie: siempre a través de repositorios.
- No mezclar lógica de sync con componentes React.
- Antes de añadir una dependencia, explicar por qué y comprobar que está mantenida y funciona en web + Tauri + Capacitor.
- No inventar APIs: ante una librería nueva o cambiante (Supabase, Tauri 2, Capacitor, TipTap, dnd-kit), **consultar su documentación actual** en lugar de fiarse de memoria.
- Usa las bibliotecas de cifrado previstas en la sección 6. Versiona los cambios de formato y prepara una migración cuando proceda.
- Preferir soluciones simples; señalar explícitamente cualquier decisión que cierre puertas (formato de ops, esquema del servidor, formato de claves).
- Mantener este documento actualizado cuando cambie una decisión (sección "Decisiones tomadas" más abajo).

## 11. Decisiones tomadas / pendientes

**Tomadas**
- En la 0.10.0 Rutinas añade checklists diarias y semanales, accesibles también desde Hoy. La zona horaria de creación fija los límites de cada ciclo y las marcas se sincronizan por paso y ciclo. Los cambios de frecuencia o pasos y las pausas se aplican a partir del siguiente ciclo.
- En la 0.6.0 se retiraron de la interfaz las vistas guardadas y la edición de propiedades personalizadas. Se conservan los datos existentes y el protocolo de sincronización.
- Nombre: **Organify**. Scope de paquetes sugerido: `@organify/*` (core, storage, sync, crypto, ui).
- TypeScript + React + Vite, web/PWA primero, Tauri (PC) y Capacitor (solo Android) después.
- **FullCalendar** para el calendario (plugins MIT, detrás de `<CalendarView>`).
- **TipTap + Yjs** para las notas en bloques.
- **iOS nativo descartado** por ahora. iPhone y iPad usan la PWA añadida a la pantalla de inicio, que también recibe avisos push. La PWA instalada pide almacenamiento persistente con `navigator.storage.persist()`.
- Dexie (IndexedDB) como almacenamiento local inicial, detrás de repositorios.
- Sync por log de operaciones cifradas sobre Supabase (servidor tonto).
- LWW por campo con HLC + Yjs para notas.
- E2EE con libsodium, clave maestra + passphrase (Argon2id) + clave de recuperación.
- **Compactación del log**: diferida, diseño en 5.5.
- **SQLite**: no se migra de entrada (criterios abajo).

**Cuándo migrar de Dexie a SQLite (revisar tras la Fase 4, con datos reales)**
Solo migrar si se cumple alguno de estos disparadores:
- Rendimiento: las vistas con decenas de miles de items se notan lentas pese a índices en Dexie.
- Consultas complejas (joins, agregaciones, vistas guardadas muy elaboradas) que se vuelven incómodas en IndexedDB.
- Se quiere búsqueda de texto completo (FTS5) en lugar de MiniSearch en memoria.
- Problemas de fiabilidad del almacenamiento en alguna plataforma. Al descartar iOS desaparece el riesgo principal (que el sistema borre IndexedDB); aun así, pedir almacenamiento persistente con `navigator.storage.persist()`, y recordar que el servidor conserva el log cifrado como copia.
Si llega el momento, el cambio queda confinado a `packages/storage` gracias a la interfaz de repositorio.

- **Avisos push en la PWA** (Android, escritorio e iOS 16.4+ instalada): opcionales por dispositivo. Una Edge Function de Supabase (`organify-push`), invocada por `pg_cron` cada minuto, envía Web Push con VAPID y cifrado aes128gcm implementados con Web Crypto, sin dependencias. El contenido es genérico: el servidor no conoce la tarea, solo la hora y un identificador aleatorio. Tauri y Capacitor siguen con avisos nativos.

**Pendientes**
- Ninguna decisión bloqueante para empezar.
