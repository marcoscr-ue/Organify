# Diseño de Eventos — versión 0.15

## Objetivo

Añadir a Organify una sección de **Eventos** para gestionar citas y compromisos fijos, como clases, reuniones y quedadas. Los eventos aparecen en el calendario junto a las tareas, pero tienen un significado y un ciclo de vida distintos.

- Una **tarea** es una actividad flexible que se puede completar, reprogramar y, si tiene duración estimada, mostrar en «En curso».
- Un **evento** es un compromiso situado en una fecha y hora concretas. No tiene estado de tarea, duración estimada ni aparece en «En curso».
- Un evento puede ser único o formar parte de una serie repetible.
- Las ocurrencias futuras se calculan a partir de la regla de repetición; no se guardan como eventos independientes salvo cuando tienen una excepción.

La experiencia deseada es similar, en lo esencial, a Google Calendar: al editar o borrar una repetición, se puede actuar sobre una ocurrencia, sobre esa ocurrencia y las siguientes, o sobre toda la serie.

## Decisiones de diseño

1. **Eventos y tareas son entidades distintas.** No se reutiliza el modelo de tareas ni se simula un evento con una tarea sin completar.
2. **Las series tienen tramos.** Una serie lógica puede dividirse en varios tramos cuando se cambia «este evento y los siguientes».
3. **Los tramos comparten un grupo estable.** Aunque una serie se divida, todos sus tramos conservan un identificador común para representar la misma cadena de compromisos.
4. **Las excepciones se guardan por ocurrencia original.** Una ocurrencia movida conserva su identidad original para que siga vinculada a la fecha de la serie de la que procede.
5. **Las ocurrencias normales se generan al consultar.** No se materializan por adelantado todas las fechas de una serie. La consulta expande solo el intervalo visible o necesario.
6. **La repetición guarda una zona horaria.** Una clase programada a las 18:00 debe seguir a las 18:00 al cambiar el horario de verano.
7. **Las reglas iniciales son intencionadamente acotadas:** sin repetición, diaria, semanal o mensual, con una fecha final opcional. Se pueden ampliar más adelante sin cambiar el significado de las reglas iniciales.
8. **El calendario combina eventos y tareas**, pero permite distinguirlos visualmente y conserva las acciones y campos propios de cada tipo.

## Modelo conceptual

La implementación concreta puede adaptar los nombres a las convenciones de los paquetes existentes, pero debe conservar estos conceptos:

### Evento único

Contiene como mínimo:

- Identificador.
- Título.
- Inicio y fin para eventos con hora, o fechas de inicio y fin para eventos de día completo.
- Zona horaria aplicable.
- Notas opcionales.
- Color opcional.
- Recordatorio opcional a partir de la fase de avisos.
- Campos comunes que ya utilice Organify, si son necesarios para repositorios y sincronización.

### Serie y tramo

Un evento recurrente se define mediante un tramo con:

- Identificador del tramo.
- Identificador estable del grupo lógico de la serie.
- Datos del evento (título, hora, duración, notas, etc.).
- Regla de repetición: frecuencia diaria, semanal o mensual, intervalo y fecha final opcional.
- Zona horaria IANA para eventos con hora, por ejemplo `Europe/Madrid`.
- Fecha inicial y, si corresponde, hora local de inicio.
- Límite exclusivo del tramo cuando se divide o se corta, independiente de la fecha final inclusiva de la regla.

Un grupo puede contener varios tramos ordenados temporalmente. Los tramos anteriores conservan su regla; un tramo nuevo comienza en la fecha desde la que se aplica el cambio.

### Excepción de ocurrencia

Una excepción se identifica por el tramo y el **inicio local previsto** de la ocurrencia. Para los eventos de día completo, la clave usa la fecha civil. Puede representar:

- Cancelación de esa ocurrencia.
- Cambio de hora o duración.
- Cambio de título u otros datos editables de esa ocurrencia.

Una edición puntual guarda los campos modificados. Los demás se heredan del tramo, incluso tras un cambio en la serie. Una ocurrencia movida conserva su clave original y se muestra solo en su destino. Cuando una división conserva la excepción, esta queda vinculada al tramo sucesor con el mismo inicio previsto. Una cancelación oculta la ocurrencia original.

### Repetición y fin de serie

- La fecha final es **inclusiva**. Se compara con la fecha de inicio prevista de cada ocurrencia en la zona de la serie. Un evento puede terminar después de esa fecha si empezó dentro de ella.
- La repetición mensual mantiene el día de inicio. Si ese día no existe en un mes, se omite ese mes y se mantiene el día para los siguientes. Una serie mensual del 31 pasa de enero a marzo. Para los días 29, 30 y 31, el formulario muestra «Se omitirán los meses que no tengan ese día».
- Los eventos con hora conservan la hora local prevista y la zona IANA de la serie. Al consultar, se resuelve cada inicio a un instante para mostrarlo en el calendario. Si la hora local no existe, se desplaza esa ocurrencia por la diferencia del cambio de hora. Si la hora se repite, se usa el primer instante. En Madrid, las 02:30 de una serie semanal se muestran a las 03:30 el domingo del salto de primavera y una sola vez en la primera 02:30 del cambio de otoño. La clave de ambas ocurrencias usa las 02:30 previstas.
- Los eventos de día completo usan fechas civiles y un fin exclusivo para representar uno o varios días. Conservan esas fechas al consultar desde otra zona horaria.

## Comportamiento de edición y borrado

Al editar o borrar una ocurrencia recurrente, la interfaz ofrece:

### Este evento

- Editar: guarda una excepción para esa ocurrencia.
- Borrar: marca esa ocurrencia como cancelada.
- Las demás ocurrencias no cambian.

### Este evento y los siguientes

- Usa el inicio previsto como punto de corte, incluso si se abre una ocurrencia movida. Si la cita pasó del martes al viernes, el corte sigue siendo el martes.
- Al editar, cierra el tramo seleccionado justo antes del corte y crea un tramo sucesor. Conserva las excepciones anteriores según su inicio previsto.
- Si cambian solo campos como el título o el color, conserva las reglas y horarios de los tramos posteriores y aplica en ellos los campos editados. Las excepciones futuras conservan sus propios cambios y cancelaciones.
- Si cambian la regla o el horario, el nuevo tramo sustituye la programación desde el corte. Antes de confirmar, indica qué tramos posteriores se reemplazarán y cuántas excepciones se retirarán desde el corte, incluida la seleccionada si tenía una excepción.
- Al borrar, conserva la programación y las excepciones con inicio previsto anterior al corte. Desde el corte se retiran los tramos y las excepciones afectados.

### Todos los eventos

- Actúa sobre el grupo lógico completo, incluidos sus tramos.
- Al editar, aplica solo los campos cambiados. Renombrar una serie con un tramo a las 18:00 y otro a las 19:00 conserva ambos horarios, así como los campos propios de las excepciones.
- Si se cambia el horario o la regla, muestra antes de confirmar los tramos cuya programación cambiará o se reemplazará y cuántas excepciones se retirarán. Se conservan las excepciones cuyo inicio previsto siga generándose y pueda vincularse sin ambigüedad a la programación resultante.
- Al borrar, retira el grupo completo, incluidos sus tramos y excepciones.

La interfaz debe mostrar estas opciones solo cuando la acción se realiza sobre una ocurrencia de una serie. Los eventos únicos se editan o borran directamente.

## Agenda y calendario

- La sección **Eventos** ofrece acceso a la agenda de compromisos y a la creación de eventos.
- El calendario existente muestra eventos y tareas en la misma cuadrícula.
- Los eventos se distinguen visualmente de las tareas y tienen su propio detalle y editor. Las acciones disponibles dependen de la fase y del tipo de evento.
- Las ocurrencias se expanden solo para el rango visible, con margen suficiente para eventos que cruzan los límites de ese rango.
- La consulta excluye los inicios originales cancelados o desplazados e incluye las excepciones movidas cuyo intervalo efectivo solape el rango, aunque su inicio original quede fuera.
- Al mover una ocurrencia recurrente con arrastrar y soltar, se trata como una excepción puntual, salvo que el usuario elija explícitamente editar la serie.
- Los eventos no se incluyen en Hoy/En curso como tareas ni reciben estados de tarea.
- Los recordatorios reutilizan, cuando sea viable, la infraestructura de avisos existente; el recordatorio se calcula para cada ocurrencia y mantiene el contenido genérico que requiere el diseño de privacidad actual.

## Sincronización, almacenamiento y compatibilidad

Antes de implementar, revisar VERSIONADO.md, el modelo actual de operaciones y el materializador local.

En el dominio, los eventos tienen su propio modelo y repositorio. Para sincronizarlos, la primera opción es verificar el mecanismo de Rutinas. El protocolo 1 ya admite operaciones de campo `item` sobre identificadores reservados. Un espacio como `event/<uuid>` con campos propios permitiría conservar los datos en el diario y evitar su materialización como tareas. El cliente 0.14 rechaza `entity: "event"` al validar la operación descifrada, antes de materializarla.

La primera comprobación de la 0.15.0 debe cubrir la descarga de un evento por la 0.14, el intercambio de tareas en ambos sentidos y la reconstrucción del evento al actualizar ese cliente. También debe cubrir desconexión prolongada y reconexión en ambos órdenes. Si se confirma la compatibilidad, se mantiene el protocolo 1. Si la estrategia falla y el formato necesario resulta incompatible, se documentará en [VERSIONADO.md](VERSIONADO.md) la transición y el orden de despliegue antes de publicar operaciones nuevas. El log cifrado existente es la base prevista para la sincronización.

Los cambios de serie y sus operaciones pendientes se guardan en la misma transacción local. Las operaciones identifican el grupo, el tramo y, cuando corresponda, la ocurrencia original. La fase de divisiones debe definir una resolución determinista entre cambios incompatibles al futuro de un mismo grupo. Dos clientes deben llegar al mismo conjunto de tramos activos al recibir las mismas operaciones en distinto orden o con duplicados.

## Fases de desarrollo

El modelo de series, tramos y excepciones se diseña desde la primera fase para evitar reemplazar más adelante una representación provisional. Las fases separan la entrega y validación de comportamientos.

### 0.15.0 — Base de Eventos

1. Probar el intercambio de operaciones con la 0.14 mediante el mecanismo de Rutinas antes de conectar la interfaz al repositorio.
2. Implementar el modelo y la expansión por rango en `packages/core`, con pruebas de fechas y zonas horarias. Definir desde aquí las identidades del grupo, el tramo y la ocurrencia, además del modelo de excepción.
3. Implementar el repositorio y la sincronización de los eventos únicos y del tramo inicial de cada serie. Persistir la definición de cada serie y calcular sus ocurrencias al consultar.
4. Añadir la agenda **Eventos**, el formulario y la integración con el calendario existente. La fase incluye crear, editar y borrar eventos únicos y crear series diarias, semanales y mensuales con intervalo y fecha final opcional. Al pulsar una ocurrencia recurrente se abre su detalle de consulta. La interfaz reserva las acciones de edición, borrado y arrastre de ocurrencias para sus fases de alcance.

**Criterios de aceptación**

- Crear un evento único con hora, editarlo y borrarlo desde la agenda o el calendario. Crear un evento de día completo y comprobar que conserva su fecha al cambiar de zona.
- Crear una serie de cada frecuencia y navegar por varios meses. Comprobar el intervalo, la última fecha inclusiva y que el almacenamiento conserva la definición sin crear filas por ocurrencia.
- Probar una serie mensual del 31 y una del 29 que atraviese febrero en años bisiestos y no bisiestos. Probar los dos cambios de hora en `Europe/Madrid` y la estabilidad de la clave de ocurrencia.
- Repetir la prueba de compatibilidad con la 0.14 y comprobar que los eventos se distinguen de las tareas en el calendario y que lista, tablero y «En curso» siguen tratando las tareas como antes.

### 0.15.1 — Excepciones de ocurrencia

- Añadir «Solo este evento» para editar una ocurrencia.
- Añadir «Solo este evento» para cancelar una ocurrencia.
- Permitir mover una ocurrencia sin desplazar el resto de la serie.
- Conservar la identidad original al cambiar la fecha y sincronizar correctamente la excepción.

**Criterios de aceptación**

- Editar y cancelar una ocurrencia afecta solo a esa fecha. Una excepción movida entre rangos aparece en el destino y deja de aparecer en el origen al navegar en ambas direcciones.
- Dos dispositivos sincronizan la misma excepción y muestran el mismo resultado.

### 0.15.2 — Tramos «este y los siguientes»

- Añadir edición de «Este evento y los siguientes» mediante división del tramo desde la ocurrencia seleccionada.
- Añadir borrado de «Este evento y los siguientes» terminando el tramo antes de la ocurrencia seleccionada y retirando los tramos posteriores del grupo.
- Mantener un identificador común de grupo a través de divisiones sucesivas.
- Aplicar las reglas de conservación y retirada de excepciones. Mostrar el efecto antes de confirmar un cambio de horario o regla.
- Resolver divisiones incompatibles creadas sin conexión.

**Criterios de aceptación**

- Dividir o cortar desde una cita desplazada y comprobar que se usa su fecha original. Verificar que las excepciones anteriores sobreviven y que las afectadas coinciden con la confirmación mostrada.
- Dividir offline desde dos dispositivos con cambios incompatibles, reconectar en ambos órdenes y comprobar que el historial converge sin tramos activos solapados.

### 0.15.3 — Operaciones sobre toda la serie

- Añadir edición de «Todos los eventos» sobre el grupo lógico completo, incluso si contiene varios tramos.
- Añadir borrado de toda la serie, incluidas sus excepciones.
- Aplicar solo los campos editados y mostrar la confirmación de cambios que afecten a la programación de varios tramos.
- Revisar accesibilidad y claridad de los diálogos de alcance.

**Criterios de aceptación**

- Renombrar un grupo con dos horarios distintos conserva ambos horarios y los cambios puntuales de sus excepciones.
- Cambiar la programación global conserva las excepciones que siguen vinculadas a un inicio previsto y retira las indicadas en la confirmación. Borrar el grupo retira también las ocurrencias desplazadas. Los clientes sincronizados muestran el mismo resultado.

### 0.15.4 — Recordatorios

- Añadir recordatorios opcionales para eventos únicos y recurrentes, reutilizando la infraestructura existente donde encaje.
- Calcular el aviso a partir del inicio efectivo de la ocurrencia y reprogramarlo o retirarlo al moverla, cancelarla o cambiar la serie. Para los eventos de día completo queda por definir la hora del aviso.

**Criterios de aceptación**

- Mover una ocurrencia reprograma su aviso y cancelar una ocurrencia o cortar la serie retira los avisos afectados. Los avisos push de la PWA conservan el contenido genérico.

Las fases pueden ajustarse durante el desarrollo, pero no se debe publicar una operación de sincronización incompatible con clientes ya distribuidos sin completar primero la revisión de VERSIONADO.md y la estrategia de despliegue.

## Fuera del alcance inicial

- Invitaciones, asistentes y disponibilidad de participantes.
- Importar o sincronizar calendarios externos.
- Reglas avanzadas como «el último jueves del mes» o reglas basadas en días laborables.
- Eventos compartidos o calendarios compartidos.
- Convertir eventos en tareas o reservar bloques de trabajo para tareas.
- Edición de «esta y las siguientes» mediante edición masiva de ocurrencias; se usa la división de tramos.

## Decisiones pendientes antes de cerrar implementación

- Valorar la ubicación después de la fase base. El formulario inicial parte de los campos del modelo conceptual disponibles en la 0.15.0.
- Decidir en la fase de avisos si se admite uno o varios recordatorios por ocurrencia y a qué hora se entregan para eventos de día completo.
