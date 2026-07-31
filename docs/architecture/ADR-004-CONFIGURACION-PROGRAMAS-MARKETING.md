# ADR-004 — Configuración de Programas de Marketing por Negocio

Estado: **PROPUESTA** (pendiente de aprobación humana antes de implementar).
Rama: `feat/configuracion-programas-marketing-v1`. Contexto: [discovery](../discovery/CONFIG_PROGRAMAS_DISCOVERY.md).

## Problema

El Director Autónomo V1 opera un **ciclo fijo** (`IDS_CICLO = d1/camp1/cont1`) con una fixture
SmileFlow única. No permite **configurar** un programa por negocio (objetivos, segmentos,
hipótesis, N campañas, N contenidos, presupuesto) ni **enumerar** múltiples entidades por org.

## Decisión (resumen)

Añadir un **paquete nuevo de orquestación/configuración** `@soec/programas` que **reutiliza los
servicios A–J sin reimplementarlos**, modela la *forma* del programa como agregados propios, y
resuelve la enumeración con el **patrón de índice existente**. Los servicios de decisiones,
campañas, contenido, ejecución, medición, aprendizaje y autonomía **no se duplican**: se invocan.

## Modelo (Fase 2)

Agregados nuevos (event-sourced, en `@soec/programas`):

- **Negocio / Perfil comercial** — stream `negconf:<org>`
  `{ id, nombre, descripcion, industria, pais, moneda, zonaHoraria, estado, modoEjecucion:'PILOT',
     problemas[], propuestaValor, capacidadesVerificadas[], restricciones[], diferenciadores[],
     informacionFaltante[] }`
- **Programa** — stream `programa:<org>:<programaId>` (agregado que porta la *estructura* del programa)
  `{ id, organizacionId, nombre, objetivoPrincipal, objetivosSecundarios[], estado,
     presupuestoTotalSimulado, moneda, fechaInicioHipotetica, fechaFinHipotetica,
     segmentos: Segmento[], hipotesis: Hipotesis[],
     campanias: [{ campaignId, segmentoId, hipotesisId, presupuestoSimulado, duracionHipotetica,
                   contenidoIds[], decisionId }] }`
  - **Segmento** y **Hipótesis** se **embeben** en el Programa (son config propiedad del programa,
    pequeña; evita streams extra). Campos según la directiva.
- Índices (patrón `@soec/evaluacion`):
  - `orgindice` — **registro** de organizaciones piloto (ids + nombre, para el selector dinámico).
  - `progindice:<org>` — lista de `programaId` por organización.

Entidades **reutilizadas por referencia** (agregados A–J, sin cambios de dominio):
`decmkt:<org>:<id>` (decisión), `campania:<org>:<id>`, `contenido-gob:<org>:<id>`,
`ejec:<org>:<contenidoId>`, `aprendizaje:<org>:<id>`, `autonomia:<org>`.

Servicios nuevos: `NegocioConfigService`, `ProgramaService` (CRUD gobernado + índices),
`CicloProgramaService` (orquesta el ciclo A–J **por programa**, análogo a `ejecutarPiloto` pero
parametrizado por la configuración real, no por la fixture).

## Resolución de las 8 preguntas (Fase 3)

1. **¿Agregados propios?** Sí: `Negocio` y `Programa` como agregados nuevos. Segmentos e hipótesis
   embebidos en `Programa`. Las campañas/contenidos/decisiones **no** se re-modelan: se referencian.
2. **Relación con el EventStore.** Mismo `EventStore` inyectado; nuevos streams (`negconf:`,
   `programa:`, `progindice:`, `orgindice`). Nada de nuevas tablas ni migraciones (tabla `events`).
3. **Enumeración.** Vía índices (`orgindice`, `progindice:<org>`) + las listas que porta el
   `Programa` (campañas, segmentos, hipótesis, contenidoIds). Sin scan por prefijo.
4. **Reconstrucción de múltiples entidades.** Cargar `Programa` → tiene todos los ids → `readStream`
   de cada agregado A–J por id → componer la vista. Nueva `reconstruirVistaPrograma(store, org, programaId)`.
5. **Separación entre organizaciones.** Todo stream de datos es `…:<org>:…`; guardas de org en cada
   servicio. Caveat honesto: `orgindice` es un **registro** (lista ids+nombres, como el catálogo
   actual); los **datos** de cada org permanecen estrictamente aislados y no cruzables.
6. **Migración desde ids fijos.** Ids **scopeados por programa** y determinísticos:
   `decisionId=<programaId>-d<n>`, `campaignId=<programaId>-c<n>`,
   `contentId=<programaId>-c<n>-p<m>`. Elimina la colisión `d1/camp1/cont1` entre programas.
7. **Se conserva el demo existente.** `ejecutarPiloto` + los 4 endpoints actuales quedan
   **intactos** (retrocompatibles). El nuevo bloque es **aditivo**: endpoints y vista por programa.
   La fixture pasa a ser **una demo/seed más**, no la única vía.
8. **Impedir presentar simulado como real.** Se reutiliza `ClasificacionRoi` (ROI SIMULADO nunca
   REAL), los badges de naturaleza (REAL/SIMULADO/ESTIMADO/DESCONOCIDO), y un aviso permanente en
   la UI. `modoEjecucion` del negocio es `PILOT`; canales reales `DISABLED`; gasto real `0`.

## Decisión sobre autonomía (trade-off explícito)

V1 **reutiliza `@soec/autonomia` a nivel de organización sin modificarlo** (`autonomia:<org>`). Los
endpoints `…/programas/:programaId/{pausar,reanudar}` operan la PAUSA **de la organización** (una
pausa detiene la ejecución autónoma de esa org). **Autonomía por programa** queda como refinamiento
futuro documentado (requeriría extender `autonomiaStreamId` con un sufijo de programa, cambio menor
y retrocompatible, pero fuera del mínimo de este bloque). Se señala para no confundir el alcance.

## Único cambio de dominio propuesto

Añadir a `EntradaCampania` campos **opcionales** de vínculo (`programaId?`, `segmentoId?`,
`hipotesisId?`) — retrocompatible (los tests y el demo existentes siguen pasando con ellos
`undefined`). Alternativa considerada y descartada: guardar el vínculo solo en el `Programa` (más
desacoplado, pero pierde la trazabilidad campaña→programa en el propio agregado de campaña). Se
elige añadir los opcionales por trazabilidad bidireccional, con costo mínimo.

## Qué NO se hace (anti-duplicación)

No se crean servicios nuevos de decisión, campaña, contenido, ejecución, medición, aprendizaje ni
autonomía. `@soec/programas` **compone** los existentes. Si en implementación aparece la tentación
de reescribir alguno, se detiene y se revisa contra esta ADR.

## Consecuencias

- (+) Habilita programas reales por negocio, enumeración multi-campaña y el caso SmileFlow válido.
- (+) Reutiliza A–J; sin migraciones; demo intacto; aislamiento conservado.
- (−) Autonomía sigue siendo por org en V1 (documentado).
- (−) Superficie nueva considerable (paquete + endpoints + UI + proyección). Se implementa por fases
  con verificación incremental.
