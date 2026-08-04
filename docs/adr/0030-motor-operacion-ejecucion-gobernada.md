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
  probada (84 tests en 6 archivos: validación autoritativa, idempotencia lógica + CONFLICTO, ciclo
  presupuestario, compensación de primera clase, retry canónico con re-evaluación de gates por intento,
  reconciliador exhaustivo de 12+ clases, matriz de 18 fallos parciales por frontera con conteos, matriz de
  30 escenarios con test exacto, replay frío integral, clasificación M8 e inmutabilidad — ver Adenda 3).
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

### Matriz de 30 escenarios adversariales

La versión definitiva de esta matriz —con el NOMBRE EXACTO de cada test y sus aserciones— está en la
**Adenda 3** (reauditoría). Se conserva aquí solo la referencia para no duplicar.

## Adenda 3 — reauditoría y cierre focalizado (dictamen `AUDITORIA_M7_REQUIERE_REAUDITORIA_Y_CIERRE_FOCALIZADO`)

La auditoría externa objetó (con razón) que el informe afirmaba MÁS cobertura de la demostrada: el
reconciliador enumeraba 4 clases, la matriz de 30 y la de fronteras no citaban tests exactos ni aserciones,
y varios gates de retry no estaban probados individualmente. Se cerró **demostrando y completando** la
cobertura, sin nueva arquitectura. Cobertura total M7: **84 tests** en 6 archivos; `pnpm verify` global
verde (190 archivos / 1205 tests). Archivos y siglas: `operacion-m7.test.ts` (O), `hardening-m7.test.ts`
(H), `reconciliador-matriz-m7.test.ts` (R), `fronteras-m7.test.ts` (F), `retry-gates-m7.test.ts` (G),
`m8-contratos-m7.test.ts` (M8).

Correcciones de fondo surgidas de la reauditoría (no solo tests):
- **Reconciliación FORWARD**: una orden `EN_EJECUCION` cuyo efecto YA se aplicó se completa hacia
  `EJECUTADA_SIMULADA` (confirma consumo, cierra) en lugar de marcarse `FALLIDA` — antes se perdía el efecto.
- **Consumo idempotente por `rid`** + reparación `CONSUMO_FALTANTE`: si `reserva.confirmada` ocurre pero
  `consumo.registrado` falla, el reconciliador registra el consumo faltante (sin doble conteo).
- **Presupuesto en reintento**: la reserva ya comprometida de la misma ejecución lógica se HONRA sin volver
  a sumar la estimación (se corrige un doble conteo del propio compromiso).
- **`encolar` robusto** ante contador de intentos desincronizado (salta ids ya usados) y **reconciliador**
  que localiza el último trabajo por escaneo (no asume `st.intentos`).
- **`emitirEvidencia` idempotente**: reutiliza un stream de evidencia huérfano y solo completa el enlace.

### Matriz EJECUTABLE del reconciliador (12 clases + consumo) — archivo R

| Clase de inconsistencia | Detector | Clasificación | Test (R) |
|---|---|---|---|
| ORDEN_PROGRAMADA_SIN_TRABAJO | programada sin trabajo | REPARADA (encola) | `ORDEN_PROGRAMADA_SIN_TRABAJO ⇒ REPARADA (encola) [esc. 15]` |
| ORDEN_EN_EJECUCION_ABANDONADA | lease vencido, sin efecto | REPARADA (FALLIDA) | `ORDEN_EN_EJECUCION_ABANDONADA (lease vencido, sin efecto) ⇒ REPARADA (FALLIDA) [esc. 6]` |
| ORDEN_EJECUTADA_SIN_EVIDENCIA | ejecutada sin traza | REQUIERE_INTERVENCION | `ORDEN_EJECUTADA_SIN_EVIDENCIA ⇒ REQUIERE_INTERVENCION (no fabrica traza) [esc. 12]` |
| ORDEN_VIGENCIA_PERDIDA | M6/aprobación/calendario perdidos, pre-efecto | REPARADA (OBSOLETA) | `ORDEN_VIGENCIA_PERDIDA (aprobación revocada, pre-efecto) ⇒ REPARADA (OBSOLETA) [esc. 3/4/9]` |
| EFECTO_SIN_CONSUMO | efecto aplicado, cierre falló | REPARADA (confirma+cierra) | `EFECTO_SIN_CONSUMO (efecto aplicado, cierre falló) ⇒ REPARADA (confirma + cierra) [esc. 11/13]` |
| CONSUMO_FALTANTE | reserva confirmada sin consumo | REPARADA (registra) | (F · frontera `consumo`) y detector (K1) |
| CONSUMO_INCOHERENTE | consumo > confirmado | REQUIERE_INTERVENCION | `CONSUMO_INCOHERENTE (consumo > confirmado) ⇒ REQUIERE_INTERVENCION [esc. 6/read-model]` |
| TRABAJO_EN_ORDEN_TERMINAL | trabajo activo con orden terminal | REPARADA (falla trabajo) | `TRABAJO_EN_ORDEN_TERMINAL (trabajo activo con orden cancelada) ⇒ REPARADA (falla el trabajo) [esc. 22/26]` |
| TRABAJO_HUERFANO | trabajo sin orden | REPARADA (falla trabajo) | `TRABAJO_HUERFANO (trabajo sin orden) ⇒ REPARADA (falla el trabajo) [esc. 1/read-model]` |
| RESERVA_HUERFANA | reserva sin ejecución, orden terminal | REPARADA (libera) | `RESERVA_HUERFANA (reserva sin ejecución, orden cancelada) ⇒ REPARADA (libera) [esc. 10/11]` |
| COMPENSACION_INCOMPLETA | compensación EN_EJECUCION | REPARADA (a término) | `COMPENSACION_INCOMPLETA (quedó EN_EJECUCION) ⇒ REPARADA (la lleva a término) [esc. 20]` |
| INDICE_INCOMPLETO | orden con reserva ausente del índice | REPARADA (reindexar) | `INDICE_INCOMPLETO (orden con reserva ausente del índice) ⇒ REPARADA (reindexar) [esc. 14]` |
| EVIDENCIA_INCOHERENTE | evidencia naturaleza ≠ SIMULADO | REQUIERE_INTERVENCION | `EVIDENCIA_INCOHERENTE (naturaleza ≠ SIMULADO) ⇒ REQUIERE_INTERVENCION [esc. 24]` |

Convergencia concurrente y no-op tras replay frío: R · `dos reconciliadores concurrentes convergen…` y
`tras reparar y hacer replay frío, un nuevo reconciliador no encuentra nada que reparar`.

### Matriz de fallos parciales — 18 fronteras (archivo F)

Un test parametrizado (`frontera '<nombre>': falla → repara → efecto y consumo exactamente una vez → orden
ejecutada`) recorre las 18 fronteras: `crear-orden`, `validar (transición #1)`, `programar (transición #2)`,
`encolar-trabajo`, `indice-orden`, `lease (reclamar)`, `en-ejecucion (transición #4)`, `intento`, `reserva`,
`indice-reserva`, `marca-presupuesto`, `efecto (sandbox/resultado)`, `confirmacion`, `consumo`, `evidencia`,
`referencia-evidencia`, `cierre-orden (transición #5)`, `cierre-trabajo`. Cada caso falla la ocurrencia exacta
UNA vez y acredita: estado parcial → reparación (retry idempotente / reconciliación) → nuevo intento no-op →
**conteos** (`efecto.aplicado`=1, `consumoTotal`=3, reserva `CONFIRMADA`, versión de orden > 0). Además F ·
`convergencia concurrente…` (dos reparadores no duplican el efecto) y F · `replay frío tras reparar una
frontera reproduce el mismo resultado`. Las fronteras de `liberación`/`compensación`/`reconciliación` se
cubren en R (RESERVA_HUERFANA, COMPENSACION_INCOMPLETA) y en el propio arnés de reconciliación.

### Re-evaluación de gates entre intentos (archivo G)

| Gate mutado durante el backoff | Efecto en el intento 2 | Test (G) |
|---|---|---|
| PAUSA | detiene (lanza), sin efecto | `PAUSA activada durante el backoff ⇒ el intento 2 se detiene (sin efecto)` |
| vigencia M6 (variante) | FALLIDA, sin efecto | `vigencia M6 perdida (variante revocada) durante el backoff ⇒ intento 2 FALLIDA (sin efecto)` |
| aprobación de pieza | FALLIDA, sin efecto | `aprobación de PIEZA revocada durante el backoff ⇒ intento 2 FALLIDA (sin efecto)` |
| calendario | FALLIDA, sin efecto | `entrada de calendario cancelada durante el backoff ⇒ intento 2 FALLIDA (sin efecto)` |
| expiración | EXPIRADA, sin efecto | `ventana de expiración vencida durante el backoff ⇒ intento 2 EXPIRADA (sin efecto)` |
| cancelación | CANCELADA, sin efecto | `cancelación durante el backoff ⇒ intento 2 no produce efecto; la orden queda CANCELADA` |
| presupuesto | reserva HONRADA, sin doble reserva | `presupuesto: la reserva del intento 1 se HONRA en el reintento…` |
| capacidad/health/breaker/kill-switch | adaptador RE-INVOCADO; clase no reintentable detiene | `el adaptador se re-invoca en el intento 2; una clase NO reintentable… lo detiene sin efecto` |

(Los cuatro gates del sandbox M4 se re-evalúan porque el adaptador se re-invoca en cada intento; su lógica
interna está probada en `@soec/adaptadores`.)

### Contratos M8 (archivo M8)

`ejecutada SIN evidencia ⇒ PARCIAL y NO medible`; `EN_EJECUCION ⇒ NO_RECONCILIADA y NO medible`; `una orden
con stream pero ausente del índice NO aparece en el listado M8 (huérfana excluida)`; `los snapshots M8 son
profundamente inmutables…`; `tras ejecutar+compensar, el listado M8 y el consumo son IDÉNTICOS desde un store
nuevo (log serializado)` — preserva estado, consumo, reserva y compensación tras replay frío.

### Matriz de 30 escenarios adversariales → test exacto

| # | Escenario | Test exacto (archivo · it) |
|---|-----------|----------------------------|
| 1 | Org A creada/reclamada por org B | O · `cross-tenant: org B no puede reclamar el trabajo de org A` |
| 2 | Pieza OBSOLETA antes de ejecutar | O · `vigencia perdida entre encolar y ejecutar ⇒ no hay efecto (FALLIDA)…` |
| 3 | Variante pierde aprobación en cola | H · `variante revocada estando la orden EN_COLA ⇒ el gate M6 rechaza…` ; R · `ORDEN_VIGENCIA_PERDIDA…` |
| 4 | Calendario cancelado tras crear | H · `entrada de calendario CANCELADA (defensa en profundidad)…` ; G · `entrada de calendario cancelada durante el backoff…` |
| 5 | Dos workers mismo trabajo | O · `dos workers concurrentes reclaman el mismo trabajo ⇒ uno gana, el otro ConcurrencyError…` |
| 6 | Lease expira durante ejecución | R · `ORDEN_EN_EJECUCION_ABANDONADA (lease vencido, sin efecto)…` ; O · `reconcilia una orden EN_EJECUCION abandonada…` |
| 7 | Timeout + respuesta tardía | O · `timeout+re-reclamo con lease vencido ⇒ el efecto no se duplica (DUPLICADA)` |
| 8 | Cancelación durante backoff | G · `cancelación durante el backoff ⇒ intento 2 no produce efecto…` |
| 9 | Reintento tras perder vigencia | G · `vigencia M6 perdida (variante revocada) durante el backoff…` |
| 10 | Presupuesto agotado antes de ejecutar | H · `éxito ⇒ reserva CONFIRMADA…; agotar el tope ⇒ RECHAZADA sin reservar` |
| 11 | Reserva duplicada | R · `EFECTO_SIN_CONSUMO…` ; F · frontera `reserva`/`indice-reserva` (idempotente) |
| 12 | Ejecución exitosa pero falla evidencia | F · frontera `evidencia` ; R · `ORDEN_EJECUTADA_SIN_EVIDENCIA…` |
| 13 | Evidencia creada pero falla cierre | F · frontera `referencia-evidencia`/`cierre-orden` ; R · `EFECTO_SIN_CONSUMO…` |
| 14 | Fallo parcial en índice/read-model | F · frontera `indice-orden` ; R · `INDICE_INCOMPLETO…` |
| 15 | Reinicio con trabajos EN_EJECUCION | R · `ORDEN_PROGRAMADA_SIN_TRABAJO…` ; F · frontera `en-ejecucion`/`intento` |
| 16 | Replay frío desde log serializado | R · `…replay frío, un nuevo reconciliador no encuentra nada…` ; M8 · `…IDÉNTICOS desde un store nuevo…` |
| 17 | Dos reconciliadores concurrentes | R · `dos reconciliadores concurrentes convergen…` |
| 18 | Evento duplicado | H · `éxito ⇒ reserva CONFIRMADA y consumo una vez…` (reducers idempotentes) ; F · convergencia concurrente |
| 19 | Idempotency key con contenido distinto | O · `misma clave lógica con contenido distinto ⇒ CONFLICTO_IDEMPOTENCIA (no ejecuta)` |
| 20 | Compensación duplicada | H · `compensar ejecución exitosa ⇒ COMPENSADA…; doble compensación converge` ; R · `COMPENSACION_INCOMPLETA…` |
| 21 | Orden terminal reprogramada | H · `orden CANCELADA (terminal) no puede reprogramarse ni re-encolarse (FSM)` |
| 22 | Fecha pasada / expiración | O · `scheduler: instante expirado ⇒ EXPIRADA` ; H · `ventana vencida al reclamar…` ; G · `ventana de expiración vencida durante el backoff…` |
| 23 | Error sensible que se filtra | H · `la evidencia NO contiene secretos/cuerpos y su naturaleza es SIMULADA (nunca REAL)` |
| 24 | Ejecución marcada REAL por adaptador | O · `ejecuta a través del SANDBOX AUTORITATIVO de M4…` ; R · `EVIDENCIA_INCOHERENTE (naturaleza ≠ SIMULADO)…` |
| 25 | Resultado manipulado tras retorno | M8 · `los snapshots M8 son profundamente inmutables; mutarlos falla…` |
| 26 | Falso éxito tras cancelación | H · `reclamar tras CANCELAR ⇒ no hay falso éxito…` ; R · `TRABAJO_EN_ORDEN_TERMINAL…` |
| 27 | Cross-tenant vía IDs conocidos | O · `cross-tenant: org B no puede reclamar el trabajo de org A` |
| 28 | Obsolescencia entre dos reintentos | G · `vigencia M6 perdida (variante revocada) durante el backoff…` |
| 29 | Listado devuelve ejecuciones parciales | M8 · `ejecutada SIN evidencia ⇒ PARCIAL y NO medible` ; `EN_EJECUCION ⇒ NO_RECONCILIADA…` |
| 30 | M8 intenta modificar una ejecución | M8 · `los snapshots M8 son profundamente inmutables…` ; `…huérfana excluida` |

## Alcance respetado

Todo SIMULADO: sin SDK, red, publicación, gasto, canales ni credenciales. Presupuesto en unidades lógicas
ESTIMADO/SIMULADO, nunca REAL. `AUTONOMOUS_REAL` bloqueado. M7 no publica ni ejecuta efectos reales.
