# ADR-0031 — M8 · Motor de Medición, Aprendizaje y Conocimiento Operacional

Estado: aceptado · Fecha: 2026-08-03 · Rama: `feat/macrobloque-4d` · Paquete: `@soec/motor-medicion`

## Contexto

M7 opera (ejecución gobernada, SIMULADA). M8 **aprende**: transforma los resultados operacionales de M7 en
observación, medición, evaluación de resultado e hipótesis, atribución cauta, aprendizaje canónico y
recomendaciones explicables — para que **M9** decida. M8 NO ejecuta, NO modifica la historia y NO optimiza
automáticamente. Principio central: un resultado no es un aprendizaje; una correlación no es causalidad; un
éxito técnico no es un éxito comercial. Se separan estrictamente: esperado ╪ ejecutado ╪ observado ╪ medido
╪ atribuible ╪ inferido ╪ aprendido ╪ desconocido.

## Decisión

Nuevo paquete `@soec/motor-medicion` (patrón `motor-estrategico`/`motor-creativo`/`motor-operacion`). Entrada
autoritativa **exclusiva**: `LecturaOperativa` de M7. **Reutiliza** (no crea máquinas paralelas):

- `@soec/medicion` — `NivelCalidad`/`SenalesCalidad`/`calidadAlMenos` (calidad), `ClaseEvidencia`/
  `ModeloAtribucion` (clase epistémica de atribución), unidades/indicadores.
- `@soec/aprendizaje` — el aprendizaje CANÓNICO de 4 capas y su guardarraíl de cruce entre organizaciones.
- `@soec/motor-estrategico` — el veredicto epistémico de las hipótesis vía `LecturaConocimiento`
  (`EstadoEvaluabilidad` VERDADERO/FALSO/GRIS/NO_EVALUABLE); M8 NO reconstruye la epistemología.

### Componentes

1. **`ObservacionOperacion`** (agregado event-sourced): hecho observado, sin interpretar. Estados
   REGISTRADA→VALIDADA|INVALIDA · VALIDADA→DESCARTADA|SUPERADA. `registrar` guarda el hecho; `validar` lo
   confronta AUTORITATIVAMENTE con M7 (orden existe, COMPLETA/medible, evidencia SIMULADA) y materializa
   pieza/variante/executionId DESDE M7. Nunca acepta naturaleza REAL; ausencia = `valor:null` (jamás 0).
2. **Evaluación de resultado** (pura): expectativa vs observación vs baseline/umbral/meta/calidad/cobertura
   → SUPERADO/CUMPLIDO/PARCIAL/NO_CUMPLIDO/NO_EVALUABLE/INCONSISTENTE. Ausencia ⇒ NO_EVALUABLE (no fracaso).
3. **Evaluación de hipótesis** (pura): liga el `EstadoEvaluabilidad` canónico de M5 con el resultado →
   RESPALDADA/REFUTADA/PARCIAL/INCONCLUSA/NO_EVALUABLE. Alcance SIEMPRE `LOCAL_AL_EXPERIMENTO`; confianza
   acotada — un experimento no generaliza.
4. **Atribución** (pura): grados ASOCIACION_DIRECTA/CONTRIBUCION/CORRELACION/ATRIBUCION_DEBIL/DESCONOCIDA/
   NO_ATRIBUIBLE + clase epistémica; invariante `afirmaCausalidadReal:false`.
5. **Recomendación** explicable: RECOMENDACION|ABSTENCION (se ABSTIENE si la evidencia es insuficiente).
6. **`EvaluacionOperacion`** (agregado event-sourced): consolida resultado+hipótesis+atribución+recomendación
   con explicación. EMITIDA→OBSOLETA (invalidación explícita; nunca en silencio).
7. **Aprendizaje operacional**: construye aprendizaje canónico (`@soec/aprendizaje`) desde una evaluación
   EMITIDA y evaluable. NO aprende desde NO_EVALUABLE (devuelve `null` = ausencia); un solo experimento es
   LOCAL (sin capa reutilizable/transferible).
8. **Consolidación** entre experimentos: solo combina si son comparables (hipótesis/segmento/KPI/métrica/
   ventana/naturaleza/atribución/contexto); si no ⇒ `NO_COMPARABLES` (prohibido promediar). Es lo único que
   eleva la confianza más allá de un experimento.
9. **Reconciliador de medición**: matriz de inconsistencias (ver abajo), clasificaciones REPARADA/
   NO_REQUIERE_ACCION/NO_REPARABLE/REQUIERE_INTERVENCION.
10. **`LecturaMedicion`** (puerto M9, solo lectura): observaciones/evaluaciones/aprendizajes/memoria con
    snapshots deep-frozen. M9 consume; no reescribe la historia de M8.

## Cobertura · **cifras y matrices definitivas en la Adenda (cierre focalizado) al final de este ADR**

> Las cifras y matrices de esta sección quedaron SUPERADAS por el cierre focalizado (95 tests / verify
> 197 archivos / 1300 tests; 12 fronteras; 12 clases de reconciliador; consolidación y obsolescencia
> completas). Ver la **Adenda** al final. Se conserva el detalle histórico a continuación.

Siglas: C=`cadena-m8`, E=`escenarios-m8`, R=`reconciliador-matriz-m8`, F=`fronteras-m8`, X=`replay-y-m9-m8`.

### Cadena operacional (C)
`ejecución → observación validada → evaluación → hipótesis RESPALDADA → aprendizaje → memoria` y su idempotencia.

### 30 escenarios adversariales → test exacto (E)
Cada escenario del Bloque Maestro tiene un `it` numerado 01–30 en `escenarios-m8.test.ts` con aserciones
sustantivas: cross-tenant (01,06), ejecución parcial/sin evidencia (02,03), REAL sobre simulada (04),
KPI inexistente/otro-tenant (05,06), unidad incompatible (07), ausencia≠cero (08), veredicto M5 canónico
(09), variante autoritativa de M7 (10), hipótesis retirada (11), evidencia contradictoria (12), no
generalizar desde uno (13), atribución sin causalidad (14), métricas incompatibles (15), aprendizaje desde
NO_EVALUABLE (16), duplicado (17), no-transferencia (18), cambio de KPI (19), retiro de evidencia (20),
resultado tras compensación (21), observación duplicada→SUPERADA (22), evaluadores concurrentes (23), fallo
parcial (24), abstención (25), memoria estable (26), inmutabilidad M9 (27), sin fuga de secretos (28),
reconciliación concurrente (29), M9 no escribe en M8 (30).

### Matriz del reconciliador — 11 clases (R)
OBSERVACION_SIN_EJECUCION_VALIDA (→descartar), OBSERVACION_SIMULADA_MARCADA_REAL (→invalidar),
EJECUCION_SIN_OBSERVACION (intervención), READ_MODEL_INCOMPLETO (→reindexar), EVALUACION_DUPLICADA,
KPI_INCONSISTENTE, UNIDAD_INCOMPATIBLE, RESULTADO_SIN_EVIDENCIA, EVALUACION_SIN_EXPLICACION,
APRENDIZAJE_SIN_EVALUACION, APRENDIZAJE_CON_EVALUACION_OBSOLETA — cada una con su `it`; más convergencia
concurrente y no-op tras replay frío.

### Fallos parciales por frontera (F)
7 fronteras de persistencia (observación, índice-observación, validación, evaluación [resultado/atribución/
hipótesis], índice-evaluación, aprendizaje, índice-aprendizaje) + obsolescencia, con retry idempotente,
conteo de eventos (evaluación emitida exactamente una vez), convergencia concurrente y replay frío.
(Medición/atribución/resultado/hipótesis se persisten dentro de `evaluacion.emitida`; memoria/reconciliación
son lectura/recuperación.)

### Replay frío integral + contratos M9 (X)
Reconstrucción de observación/evaluación/aprendizaje/memoria/lecturas M9 IDÉNTICAS desde un store nuevo; M9
no presenta ejecución sin evidencia como completa, marca lo no vigente, excluye huérfanas, es deep-frozen.

## Correcciones de correctitud surgidas de las matrices

- **FSM de observación**: una observación YA VALIDADA cuya ejecución se invalida (p. ej. compensación
  posterior) se **DESCARTA** (la FSM no admite VALIDADA→INVALIDA; INVALIDA es solo del fallo de validación
  inicial).
- **Reparación de índices en el retorno idempotente**: `registrar`/`evaluar` re-aseguran su índice aunque el
  agregado ya exista, para que un reintento tras un fallo parcial del índice lo repare.

## Alcance respetado

Todo SIMULADO/ESTIMADO — nunca REAL. Prohibido y ausente: métricas reales de canales, webhooks, SDK,
analítica externa, conversiones reales, atribución causal real, optimización automática, ejecución,
publicación, gasto, `AUTONOMOUS_REAL`. M8 produce conocimiento; no actúa.

## Deuda genuinamente posterior a M8 (para M9 o fuentes reales)

- Fuentes de métricas REALES y su normalización/atribución productiva (hoy: observación inyectada SIMULADA).
- Optimización/adaptación automática del plan (es M9).
- Consolidación multi-experimento a escala con ventanas móviles y significancia declarada (hoy: comparabilidad
  estricta + confianza acotada).

## Adenda — cierre focalizado (dictamen `AUDITORIA_M8_REQUIERE_CIERRE_FOCALIZADO`)

La auditoría objetó (con razón) cuatro brechas: fronteras de fallo parcial incompletas (7 vs 12), matriz del
reconciliador no demostrada una por una, consolidación entre experimentos no cerrada, y matriz de
obsolescencia no exhaustiva. Se cerraron **demostrándolas**, sin M9 ni nuevas máquinas. La evaluación se
DESCOMPUSO en pasos event-sourced (medición/resultado/atribución/hipótesis/recomendación/cierre), de modo
que cada paso es una frontera real. Cobertura total M8: **95 tests** en 8 archivos; `pnpm verify` global
verde (**197 archivos / 1300 tests**). Archivos: C=`cadena-m8`, E=`escenarios-m8`, R=`reconciliador-matriz-m8`,
F=`fronteras-m8`, K=`consolidacion-m8`, B=`obsolescencia-m8`, X=`replay-y-m9-m8`.

### A. 12 fronteras de fallo parcial (F)
Un `it` por frontera (`F1 registro de observación`, `F2 validación`, `F3 medición/cálculo`, `F4 evaluación de
resultado`, `F5 atribución`, `F6 evaluación de hipótesis`, `F7 registro de aprendizaje`, `F8 actualización de
memoria`, `F9 recomendación/abstención`, `F10 obsolescencia`, `F11 índices/read models`, `F12 reconciliación`).
Cada uno: fallo → estado parcial → reintento repara **sólo lo faltante** (pasos idempotentes) → reintento
adicional no-op → dos reparadores concurrentes → replay frío. Con conteo de eventos por stream y tipo
(`evaluacion.cerrada`=1, cada paso=1, `memoria.entrada`=1).

### B. Matriz del reconciliador — 12 clases (R)
`EJECUCION_SIN_OBSERVACION`, `OBSERVACION_SIN_EJECUCION_VALIDA` (→descartar), `KPI_INCONSISTENTE`,
`UNIDAD_INCOMPATIBLE`, `RESULTADO_SIN_EVIDENCIA`, `APRENDIZAJE_SIN_EVALUACION`, `EVALUACION_DUPLICADA`,
`CONSUMO_SIN_RESULTADO`, `OBSERVACION_SIMULADA_MARCADA_REAL` (→invalidar), `APRENDIZAJE_CON_EVALUACION_OBSOLETA`,
`READ_MODEL_INCOMPLETO` (→reindexar), `EVALUACION_SIN_EXPLICACION` — cada una con su `it`, clasificación
explícita (REPARADA/NO_REQUIERE_ACCION/NO_REPARABLE/REQUIERE_INTERVENCION), más convergencia concurrente y
no-op tras replay frío.

### C. Consolidación canónica multi-experimento (K) — agregado event-sourced `ConsolidacionOperacion`
Resultados RESPALDADA/REFUTADA/PARCIAL/INCONCLUSA/NO_EVALUABLE/NO_COMPARABLES. Tests: dos compatibles ⇒
RESPALDADA+TRANSFERIBLE; tres con uno incompatible ⇒ incluye 2/excluye 1; contradictorios ⇒ INCONCLUSA;
observación duplicada ⇒ no doble conteo (experimentosUnicos=1); una sola ejecución ⇒ LOCAL; exclusión por
unidad/ventana/atribución/segmento/naturaleza/contexto; cross-tenant no se incorpora; idempotencia+concurrencia
(un evento); replay frío idéntico. Reglas: no promediar incompatibles, no doble conteo, un experimento no
transfiere, contradicción reduce/impide, naturaleza SIMULADA conservada, no modifica evaluaciones históricas.

### D. Matriz de obsolescencia (B)
Estado `EstadoEvaluacion` extendido: EMITIDA→REQUIERE_REVISION→OBSOLETA. Un `it` por cada una de las **10
causas** (hipótesis/KPI/segmento/estrategia/pieza/variante/evidencia/medición/atribución/contradicción):
evaluación→OBSOLETA; aprendizaje deja de ser vigente; memoria conserva el histórico (intento persiste);
respaldadas-vigentes lo excluye; M9 marca no-vigente/no-medible. Más: REQUIERE_REVISION; una nueva versión no
sobrescribe la anterior (histórica OBSOLETA + nueva EMITIDA, memoria con ambos intentos); obsolescencia
idempotente (un evento); concurrentemente segura; el reconciliador marca el aprendizaje ligado.

### E. Contratos M9 endurecidos (X)
`LecturaMedicion` expone observaciones/evaluaciones (con vigencia/alcance/naturaleza/contradicciones)/
consolidaciones/aprendizajes/memoria; excluye huérfanas y marca lo no-vigente. Congelamiento PROFUNDO probado
sobre arrays y objetos ANIDADOS (mutar `contradicciones`/`recomendacion` falla). Aislamiento cross-tenant
verificado (org-b no ve datos de org-a).

### Correcciones de correctitud surgidas de las matrices (esta ronda)
- **Descomposición event-sourced de la evaluación** en pasos idempotentes (habilita reparar sólo lo faltante).
- **Consumo vs ejecución sin observación**: se emiten AMBAS clases (el marcador de presupuesto siempre existe
  en simulación), en vez de una heurística frágil por `presupuestoReservado`.
- **Memoria event-sourced** (`memoria.entrada`) como frontera real; la vigencia sigue derivándose del estado.
