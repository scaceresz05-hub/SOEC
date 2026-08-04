# ADR-0030 — M7 · Motor de Operación y Ejecución Gobernada (simulada)

- **Estado:** Aceptado.
- **Fecha:** 2026-08-03.
- **Rama:** `feat/macrobloque-4d` (continúa tras el cierre de M6).
- **Relación:** consume M6 (`@soec/motor-creativo` · `LecturaCreativa`) y reutiliza M4/M4-D
  (`@soec/adaptadores`: presupuesto, evidencia, retry, breaker). Invariante: M5 conoce, M6 diseña, M7 opera.

## Contexto

M7 transforma artefactos creativos **aprobados+vigentes+calendarizados** de M6 en ejecuciones gobernadas,
medibles y recuperables — SIEMPRE SIMULADAS. Discovery-first: se confirmó que `OrdenEjecucion`, el plan, el
scheduler, la cola con lease, el reconciliador y los contratos M8 son NUEVOS; el ejecutor, el presupuesto,
la evidencia, el retry y el breaker se REUTILIZAN de M4/M4-D; `LecturaCreativa.listarPiezasAprobadas` (que
ya filtra retiradas/obsoletas/no-aprobadas, exige variantes aprobadas y devuelve snapshots congelados) es la
entrada autoritativa. `AUTONOMOUS_REAL` permanece bloqueado.

## Decisión

Nuevo paquete **`@soec/motor-operacion`**:

- **`OrdenEjecucion`** (`dominio/orden.ts`): agregado event-sourced con máquina de estados EXPLÍCITA de 11
  estados (BORRADOR→VALIDADA→PROGRAMADA→EN_COLA→EN_EJECUCION→EJECUTADA_SIMULADA, con ramas CANCELADA/
  EXPIRADA/OBSOLETA/FALLIDA/COMPENSADA). Transiciones tabuladas; atajos prohibidos (guarda en el reducer y
  en el servicio). Referencia pieza/versión, variante/versión, calendario, contexto, segmento, canal
  lógico, instante, política, idempotencyKey, intentos, evidencias. Naturaleza SIEMPRE `SIMULADO`.
- **Validación AUTORITATIVA** (`operacion-service.ts:pruebaVigencia`): antes de crear y ANTES de cada
  efecto se RE-CONSULTA `LecturaCreativa` (vigencia de contexto + pieza aprobada por versión exacta +
  entrada de calendario que referencia exactamente pieza+variante, no cancelada). Nunca se confía en el
  llamador ni en copias antiguas.
- **Scheduler gobernado**: `programar` con instante+zona y **ventana de expiración** (EXPIRADA); reloj
  INYECTADO (instantes ISO); no ejecuta antes del instante disponible.
- **Cola con LEASE** (`dominio/cola.ts`): trabajo de identidad determinista (orden+intento), lease con
  vencimiento, reclamable si DISPONIBLE o lease vencido (recuperación de abandonados); entrega al-menos-una
  vez; multi-tenant por stream.
- **Ejecutor gobernado idempotente** (`reclamarYEjecutar`): reclama con concurrencia optimista (dos workers
  ⇒ uno gana, otro `ConcurrencyError`); presupuesto ANTES del efecto (M4-D `evaluarPresupuesto`/
  `estimarConservador`, unidades lógicas ESTIMADO/SIMULADO, **nunca REAL**); efecto EXACTAMENTE UNA VEZ por
  `claveEfecto` (org+orden+pieza/v+variante/v+capacidad+intento); evidencia de primera clase inmutable
  (`dominio/evidencia.ts`, sin secretos/cuerpos/stack); retry gobernado (fallo temporal ⇒ nuevo intento
  lógico re-encolado, hasta `maxIntentos`).
- **Frontera de ejecución NEUTRAL** (`contratos:PuertoEjecucionSimulada` + `AdaptadorEjecucionSimulado`):
  determinista y estrictamente simulada (patrón de `@soec/ejecucion-simulada`). El sandbox productivo de M4
  se enchufa aquí tras ratificación — nunca en este código.
- **Cancelación / compensación** (`cancelar`, `compensar`): cancelar (impedir ejecución no efectuada) ≠
  compensar (acción inversa lógica registrada, con evidencia); no se borra historia.
- **Reconciliador** (`reconciliador-service.ts`): detecta órdenes EN_EJECUCION abandonadas (lease vencido,
  sin cierre) → FALLIDA (idempotente); clasifica ejecutadas-sin-evidencia como no reparables.
- **Contratos M8** (`contratos:LecturaOperativa` + `LecturaOperativaService`): solo lectura, snapshots
  inmutables (congelados) de órdenes/plan/evidencias/trabajos. M8 consume; no modifica la ejecución histórica.

## Consecuencias

- (+) La cadena M6→orden→scheduler→cola→ejecución simulada→evidencia→reconciliación está conectada y
  probada (42 tests: validación autoritativa, vigencia-perdida-antes-del-efecto, concurrencia de lease,
  idempotencia lógica + CONFLICTO, ciclo presupuestario reserva/confirma/libera, cancelación, compensación
  de primera clase, retry canónico con backoff, expiración, reconciliación exhaustiva, fallos parciales por
  frontera, replay frío integral, cross-tenant, PAUSA, clasificación M8 e inmutabilidad — ver matriz de 30).
## Adenda — cierre interno (dictamen `AUDITORIA_M7_REQUIERE_CIERRE_INTERNO`)

Los elementos declarados como "deuda" eran criterios LOCKED. Cerrados los de mayor peso arquitectónico:

- **Integración real con el sandbox M4** (`app/adaptador-sandbox-m4.ts`): el ejecutor deja de ser un
  segundo motor; `AdaptadorSandboxM4` implementa el puerto conduciendo `OrquestadorAdaptadores` +
  sandbox autoritativo + `AdaptadorFake` en `modoSolicitado='SIMULADO'` (health fail-closed, circuit
  breaker, concurrencia, cancelación, evidencia operativa de M4; naturaleza SIMULADA garantizada por el
  sandbox). Sin proveedor/SDK/credencial real. Probado end-to-end (éxito y fallo temporal→retry).
- **Idempotencia LÓGICA separada del intento técnico** (`dominio/idempotencia.ts`): `claveEfecto` ya NO
  incluye el intento (efecto lógico estable: org+orden+pieza/v+variante/v+capacidad); el intento técnico
  se registra aparte. Reintento/timeout/replay convergen en UN efecto. Misma clave + contenido distinto
  ⇒ `CONFLICTO_IDEMPOTENCIA` (huella de contenido). Probado.
- **PAUSA como gate autoritativo** (reuso de `@soec/control`): `exigirNoPausado` bloquea programar/encolar/
  reclamar/ejecutar por alcance (organización/programa/capacidad, con precedencia global); reanudar
  desbloquea sin borrar historial. Probado.

## Adenda 2 — cierre TOTAL (dictamen `M7_COMPLETO_Y_CONSOLIDADO`)

Cerrados el resto de los criterios LOCKED, sin nueva arquitectura y sobre la misma rama:

- **Ciclo presupuestario como agregado event-sourced** (`dominio/reserva.ts`): RESERVADA →
  CONFIRMADA | LIBERADA | EXPIRADA | CANCELADA. `reservaId` determinista por ejecución LÓGICA (no por
  intento) ⇒ reserva idempotente y estable entre reintentos. Unidades lógicas; naturaleza `ESTIMADO`/
  `SIMULADO`, NUNCA `REAL`. Reserva ANTES del efecto; CONFIRMA una sola vez tras éxito; LIBERA en fallo
  terminal; se CONSERVA a través de reintentos temporales (misma ejecución lógica). Multi-tenant.
- **Compensación como agregado de primera clase** (`dominio/compensacion.ts`): PENDIENTE → EN_EJECUCION →
  COMPENSADA | FALLIDA · o NO_APLICABLE. `compensacionId` determinista; doble compensación converge; no
  borra ni altera el efecto original; sólo reverso lógico SIMULADO.
- **Retry CANÓNICO** (reuso de `decidirRetry`/`PoliticaRetry` de `@soec/adaptadores`, NO una política
  paralela): la clase de error normalizada decide el reintento (NUNCA INVALIDO/NO_AUTORIZADO/CANCELADO,
  aunque el adaptador declare `reintentable:true`); backoff aplaza el trabajo vía `disponibleDesde`; cada
  reintento RE-EJECUTA TODOS los gates (M6 vigencia+aprobación, expiración, presupuesto, idempotencia,
  PAUSA) porque re-pasa por `reclamarYEjecutar`. La política se deriva de `maxIntentos` si no se aporta una.
- **Reconciliador** (`app/reconciliador-service.ts`): órdenes PROGRAMADA-sin-trabajo (→encola),
  EN_EJECUCION abandonada por lease vencido (→FALLIDA), ejecutada-sin-evidencia (→intervención),
  reservas huérfanas (→liberar). Clasifica REPARADA/NO_REQUIERE_ACCION/NO_REPARABLE/REQUIERE_INTERVENCION;
  dos reconciliadores concurrentes convergen (concurrencia optimista).
- **Contratos M8 definitivos** (`contratos:OrdenM8` + `dominio/orden:clasificarM8`): clasificación
  semántica COMPLETA/PARCIAL/COMPENSADA/CANCELADA/OBSOLETA/EXPIRADA/FALLIDA/NO_RECONCILIADA/EN_PROCESO y
  `medible` (sólo COMPLETA), snapshots deep-frozen, huérfanas excluidas (se lista por el índice, no por
  streams sueltos). M8 mide resultados; no muta la ejecución histórica.
- **Fix de FSM** surgido de la matriz: `EN_EJECUCION→EXPIRADA` era una transición inválida que el gate de
  expiración por intento intentaba en caliente (crash si un worker tomaba un trabajo con la ventana ya
  vencida). Añadida a la tabla de transiciones y cubierta por test.

### Matriz de 30 escenarios adversariales (versionada) → prueba permanente

Cada escenario del Bloque Maestro está mapeado a un test permanente. Archivos:
`test/operacion-m7.test.ts` (O) y `test/hardening-m7.test.ts` (H).

| # | Escenario | Mecanismo/garantía | Prueba |
|---|-----------|--------------------|--------|
| 1 | Orden de org A creada/reclamada por org B | Aislamiento multi-tenant (stream lleva la org) | O · cross-tenant |
| 2 | Pieza aprobada pero OBSOLETA antes de ejecutar | Re-validación M6 (`vigenciaContexto`) antes del efecto | O · obsolescencia-antes-del-efecto |
| 3 | Variante pierde aprobación estando en cola | Gate M6 (`listarPiezasAprobadas` exige variante aprobada) | H · variante revocada EN_COLA |
| 4 | Calendario cancelado tras crear la orden | Gate M6 rechaza entrada CANCELADA (defensa en profundidad) | H · entrada de calendario CANCELADA |
| 5 | Dos workers reclaman el mismo trabajo | Lease con concurrencia optimista | O · concurrencia de lease |
| 6 | Lease expira durante la ejecución | Reconciliador (EN_EJECUCION abandonada → FALLIDA) | O · reconciliación · H · fronteras (efecto/evidencia) |
| 7 | Timeout seguido de respuesta tardía | Idempotencia lógica (un efecto) + DUPLICADA | O · idempotencia DUPLICADA |
| 8 | Cancelación durante backoff | Gate PAUSA/estado re-evaluado; sin falso éxito | H · reclamar tras cancelar · PAUSA durante backoff |
| 9 | Reintento tras perder vigencia | Cada reintento re-valida M6 (re-pasa por el reclamo) | H · backoff re-valida y ejecuta |
| 10 | Presupuesto agotado entre planificación y ejecución | `evaluarPresupuesto` antes del efecto → RECHAZADA | H · tope agotado → RECHAZADA |
| 11 | Reserva de presupuesto duplicada | `reservaId` lógico + reserva idempotente | H · ciclo presupuestario · replay frío |
| 12 | Ejecución exitosa pero falla evidencia | Fallo parcial por frontera + reconciliador | H · frontera `evidencia.operacional` |
| 13 | Evidencia creada pero falla cierre de orden | Fallo parcial + recuperación por reconciliador | H · frontera `efecto.aplicado` |
| 14 | Fallo parcial en índice/read-model | Índice idempotente; reintento repara | H · frontera `orden.creada`/`trabajo.encolado` |
| 15 | Reinicio con trabajos EN_EJECUCION | Reconciliador (lease vencido → FALLIDA → re-encola) | O · reconciliación · H · fronteras en-ejecución |
| 16 | Replay frío desde log serializado | `exportar()`/`desdeInstantanea()`; reducers puros | O · replay frío · H · replay frío integral |
| 17 | Dos reconciliadores concurrentes | Convergen (concurrencia optimista) | H · reconciliador concurrente |
| 18 | Evento duplicado | Reducers idempotentes (id determinista) | H · ciclo presupuestario (reserva idempotente) |
| 19 | Idempotency key reutilizada con contenido distinto | Huella de contenido → CONFLICTO_IDEMPOTENCIA | O · CONFLICTO_IDEMPOTENCIA |
| 20 | Compensación duplicada | Agregado de compensación idempotente | H · doble compensación converge |
| 21 | Orden terminal reprogramada | FSM prohíbe transiciones desde terminal | H · orden CANCELADA no-reprograma |
| 22 | Fecha pasada sin import histórico | Scheduler → EXPIRADA; gate de expiración por intento | O · scheduler expirado · H · ventana vencida al reclamar |
| 23 | Error sensible que intenta filtrarse | Evidencia sin secretos/cuerpos/stack (normalizada) | H · evidencia sin secretos |
| 24 | Ejecución marcada REAL por adaptador simulado | Sandbox autoritativo fija naturaleza SIMULADA | O · sandbox M4 · H · evidencia (nunca REAL) |
| 25 | Resultado manipulado tras el retorno | Snapshots M8 deep-frozen | O/H · inmutabilidad M8 |
| 26 | Falso éxito tras cancelación | Reclamo verifica EN_COLA; si no, falla sin efecto | H · reclamar tras cancelar |
| 27 | Cross-tenant vía IDs conocidos | Aislamiento por org en todos los streams | O · cross-tenant |
| 28 | Obsolescencia entre dos reintentos | Re-validación M6 por intento | H · backoff re-valida · O · obsolescencia |
| 29 | Listado devuelve ejecuciones parciales | Clasificación M8 (PARCIAL/NO_RECONCILIADA, `medible`) | H · clasificación semántica M8 |
| 30 | M8 intenta modificar una ejecución | `LecturaOperativa` es solo-lectura + snapshots congelados | O/H · inmutabilidad M8 |

Cobertura total: `test/operacion-m7.test.ts` (17) + `test/hardening-m7.test.ts` (25) = 42 tests; `pnpm verify`
global verde (186 archivos / 1163 tests).

## Alcance respetado

Todo SIMULADO: sin SDK, red, publicación, gasto, canales ni credenciales. Presupuesto en unidades lógicas
ESTIMADO/SIMULADO, nunca REAL. `AUTONOMOUS_REAL` bloqueado. M7 no publica ni ejecuta efectos reales.
