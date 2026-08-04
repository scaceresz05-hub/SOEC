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
  probada (13 tests: validación autoritativa, vigencia-perdida-antes-del-efecto, concurrencia de lease,
  idempotencia de efectos, presupuesto, cancelación, compensación, reintento, expiración, reconciliación,
  replay frío, cross-tenant, inmutabilidad M8).
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

### Deuda restante (para las siguientes rondas, honesta)
- Reserva→confirmación/liberación de presupuesto como ciclo idempotente versionado (hoy: verificación
  antes del efecto + consumo post-éxito).
- Reconciliador exhaustivo (~15 clases de la matriz del Bloque Maestro; hoy cubre las centrales).
- Compensación como agregado de primera clase con su propia máquina de estados.
- Retry con `decidirRetry`/backoff de `@soec/adaptadores` y revalidación de TODOS los gates por intento.
- Matriz completa de 30 escenarios adversariales + matriz de fallos parciales por frontera + replay frío
  integral por agregado + endurecimiento de contratos M8.

## Alcance respetado

Todo SIMULADO: sin SDK, red, publicación, gasto, canales ni credenciales. Presupuesto en unidades lógicas
ESTIMADO/SIMULADO, nunca REAL. `AUTONOMOUS_REAL` bloqueado. M7 no publica ni ejecuta efectos reales.
