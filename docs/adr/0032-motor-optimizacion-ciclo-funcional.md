# ADR-0032 — M9 · Motor de Optimización Continua Gobernada (cierre del ciclo funcional SOEC)

Estado: aceptado · Fecha: 2026-08-04 · Rama: `feat/macrobloque-4d` · Paquete: `@soec/motor-optimizacion`

## Contexto

M5 conoce · M6 diseña · M7 opera · M8 aprende · **M9 optimiza**. M9 cierra el ciclo funcional de SOEC EN
MODO EXCLUSIVAMENTE SIMULADO: transforma el conocimiento (M5), la dirección creativa (M6), la operación (M7)
y el aprendizaje (M8) en PROPUESTAS de adaptación estratégicas, explicables, versionadas y gobernadas. M9 NO
ejecuta: decide qué convendría cambiar y prepara una NUEVA versión del plan para APROBACIÓN HUMANA. Principio
rector: una recomendación no es una orden; un aprendizaje no autoriza automáticamente; una mejora simulada no
es evidencia real. `AUTONOMOUS_REAL` permanece bloqueado.

## Decisión

Nuevo paquete `@soec/motor-optimizacion`. Entrada autoritativa EXCLUSIVA: los cuatro puertos de lectura
`LecturaConocimiento` (M5), `LecturaCreativa` (M6), `LecturaOperativa` (M7), `LecturaMedicion` (M8). Antes de
optimizar VERIFICA la coherencia de versiones M5–M8. Reutiliza la aprobación CANÓNICA (`AprobacionService`,
con nuevo `TipoRecurso: PROPUESTA_OPTIMIZACION`), el presupuesto y las escrituras canónicas de cada
macrobloque (vía el puerto `AplicadorCambios`). No crea máquinas paralelas.

### Componentes

1. **`CicloOptimizacion`** (agregado event-sourced, 11 estados, pasos granulares): ABIERTO ·
   RECOPILANDO_EVIDENCIA · EVALUABLE · NO_EVALUABLE · PROPUESTAS_GENERADAS · PENDIENTE_APROBACION · APROBADO ·
   RECHAZADO · APLICADO_SIMULADO · OBSOLETO · CANCELADO. Cada paso es una frontera real de fallo/recuperación.
2. **Oportunidad** (15 tipos tipados) y **Alternativa** (con `esExperimentoControlado`: una sola variable).
3. **Motor de comparación** (puro, determinista, EXPLICABLE por dimensión): PREFERIDA · VIABLE · DOMINADA ·
   NO_COMPARABLE · NO_EVALUABLE · RECHAZADA_POR_POLITICA. No reduce a una puntuación opaca.
4. **Counterfactual** (SI_MANTENEMOS/SI_CAMBIAMOS/SI_DETENEMOS/SI_REPETIMOS), declarado SIMULADO/ESTIMADO.
5. **`NO_ACTUAR`** de primera clase (aplicar sin cambios no crea versiones).
6. **`PropuestaOptimizacion`** (agregado versionado): BORRADOR → PENDIENTE_APROBACION → (APROBADA | RECHAZADA)
   · APROBADA → APLICADA_SIMULADA · *→OBSOLETA. Aprobación HUMANA canónica; revalidación de vigencia; guarda de
   OSCILACIÓN; aplicación SIMULADA que crea NUEVAS versiones (derivaciones), nunca sobrescribe.
7. **Guardas de oscilación** (cooldown, máx. por ventana, A→B→A, reoptimizaciones).
8. **`MemoriaDecisionesService`** (event-sourced): histórico consultable de decisiones y cambios aplicados.
9. **Reconciliador M9** (16 clases) con clasificaciones REPARADA/NO_REQUIERE_ACCION/NO_REPARABLE/
   REQUIERE_INTERVENCION.
10. **`LecturaCicloSOEC`** (puerto de lectura GLOBAL, inmutable, multi-tenant): ciclos, propuestas, memoria,
    derivaciones y vigencia. No expone escritura.

## Bucle cerrado y DOS iteraciones

`M5 → M6 → M7 (ejecución simulada) → M8 (medición/aprendizaje) → M9 (propuesta) → aprobación humana → nueva
versión (M7) → nuevo ciclo`. `ciclo-m9.test.ts` demuestra el ciclo completo hasta una propuesta APROBABLE, la
aplicación simulada que crea una nueva versión del plan, y DOS ITERACIONES: el segundo ciclo corre sobre la
nueva versión sin alterar el primero (que permanece APLICADO_SIMULADO).

## Cobertura (79 tests en 5 archivos) · `pnpm verify` global verde (202 archivos / 1379 tests)

- **Ciclo + dos iteraciones** (`ciclo-m9.test.ts`): 3 tests.
- **40 escenarios adversariales** (`escenarios-m9.test.ts`), `01`…`40`: cross-tenant, evidencia no vigente,
  coherencia de versiones, KPI incompatible → NO_COMPARABLE, ausencia≠mejora, multi-variable→política,
  presupuesto, autoaprobación bloqueada, no-herencia de aprobación, obsoleta/rechazada no aplican, aplicación
  duplicada no-op, fallo del aplicador (no queda aplicada), derivación registrada, oscilación/cooldown/ventana
  bloqueados, NO_ACTUAR, riesgo alto, memoria, concurrencia, inmutabilidad, sin fuga de secretos, naturaleza
  SIMULADO, lectura global de solo lectura.
- **18 fronteras de fallo parcial** (`fronteras-m9.test.ts`): apertura/recopilación/simulación/oportunidad/
  alternativa/comparación/propuesta/solicitud/decisión/aplicación M5-M6-M7/derivación/memoria/obsolescencia/
  reconciliación/índices/cierre — con retry idempotente y conteo (derivación una sola vez).
- **Reconciliador — 16 clases** (`reconciliador-matriz-m9.test.ts`), cada una con su `it` (una FSM-garantizada:
  APLICACION_SIN_APROBACION es inalcanzable — se acredita que la máquina de estados la impide).
- **Replay frío integral de dos ciclos** + lectura global deep-frozen (`replay-m9.test.ts`).

## Correcciones de correctitud surgidas de las matrices

- **`aplicarSimulado` idempotente**: si ya está APLICADA (falló el cierre del ciclo/memoria), re-asegura el
  cierre y la memoria sin re-aplicar cambios.
- **Orden de `proponer`**: el ciclo referencia la propuesta ANTES de indexarla, para que el reconciliador la
  descubra aunque el índice falle.
- **Revalidación por versión, no por segmento**: la coherencia en aprobación/aplicación exige alguna evidencia
  M8 vigente, no la del KPI.

## Alcance respetado

Todo SIMULADO/ESTIMADO — nunca REAL. Ausente y prohibido: IA/SDK real, publicación, gasto, canales,
credenciales, métricas reales, optimización autónoma real, aplicación sin aprobación, causalidad real,
autoedición de directivas, `AUTONOMOUS_REAL`. M9 propone; el humano decide; la aplicación es simulada.

## Deuda genuinamente posterior (integraciones reales futuras)

Conectores reales (métricas/canales/pagos/proveedores), aplicación con efectos reales tras ratificación
humana del modo REAL, y las decisiones estratégicas de datos (D-1..D-7 del Centro de Integraciones).
