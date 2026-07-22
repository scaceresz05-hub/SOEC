# ADR-0013 — Medición, Atribución y Optimización Autónoma (F2-MET-01)

- **Estado:** ✅ **ACEPTADO.** Quinta vertical del Departamento de Marketing Autónomo; cierra el lazo observar → decidir → ajustar. Continúa ADR-0009/0010/0011/0012, sin abrir circuito de enmienda.
- **Fecha:** 2026-07-21 · **Bloque:** F2-MET-01.

## Contexto

F2-CHAN-01 (ADR-0012) permite publicar (emulado) y obtener referencias externas, pero SOEC no sabía **qué resultado** obtuvo cada acción ni cómo usar esa evidencia para ajustar su operación. Este ADR fija el sistema de **medición, atribución y optimización** (`@soec/medicion`): ingiere métricas de una fuente proveedor-independiente, las normaliza y evalúa, atribuye con cautela, detecta anomalías, evalúa el objetivo y **propone optimizaciones** que —tras autorización— cambian el plan de forma **versionada**. Sin gasto real, sin datos reales.

## Decisiones

### D-1. La medición observa y propone; no es un motor paralelo de marketing *(Nivel A — §3)*

Se integra a la cadena existente: **Canales → Observaciones → Medición → Evaluación → Planificador → Autorización → Ejecución**. El módulo observa, normaliza, calcula, compara, atribuye con cautela y **propone**; **no** publica, **no** gasta, **no** ejecuta adaptadores, **no** modifica el plan en silencio, **no** inventa causalidad, **no** aumenta su propia autonomía. Pruebas arquitectónicas lo verifican.

### D-2. Ingesta proveedor-independiente; el proveedor emulado sigue aislado *(Nivel A — §8, §9)*

Puerto `MetricsSource` reemplazable; implementación **emulada por HTTP** (cruza una frontera de red real hacia la API de métricas del proveedor emulado) y **simulada** (sin red). Reanudación por cursor. El proveedor emulado (`@soec/canal-emulado`, extendido con métricas y conversiones) permanece aislado: ningún archivo de dominio lo importa.

### D-3. Observación ╪ Atribución ╪ Inferencia; nunca causalidad sin mecanismo *(Nivel A — §5, §13)*

Se distingue formalmente **observación** (dato recibido), **atribución** (relación por un mecanismo identificable, p. ej. identificador de campaña) e **inferencia** (interpretación razonada). Una conversión con identificador de campaña se **atribuye**; sin identificador se clasifica como **inferencia**, nunca como conversión confirmada. La coincidencia temporal **no** implica causalidad.

### D-4. Calidad de evidencia: la ausencia de datos no es fracaso *(Nivel A — §6, §14)*

La calidad (no_disponible…confirmada) considera procedencia, completitud, muestra, consistencia y duplicados. La evaluación distingue **"sin datos"** y **"evidencia insuficiente"** de **"por debajo de umbral"**: no concluir "la campaña fracasó" cuando no hay evidencia suficiente. Umbrales **deterministas declarados** (no se inventa significancia estadística).

### D-5. Normalización sin pérdida; deduplicación que conserva la corrección *(Nivel A — §10, §11)*

Las métricas del proveedor se convierten a un **vocabulario canónico** conservando el dato original, la unidad, la versión del mapper y (si hay conversión de moneda) la **tasa explícita** (sin conversiones silenciosas). La deduplicación conserva la **corrección legítima** (mayor secuencia del proveedor) y descarta el **duplicado exacto**; los datos tardíos reevalúan **sin duplicar**.

### D-6. Indicadores deterministas; atribución y anomalías versionadas *(Nivel A — §12, §21)*

Motor de indicadores **determinista** con fórmulas versionadas (CTR, tasa de conversión, CPL, CPA, ROAS…), sin LLM en la aritmética; evita la división por cero (valor no calculable), conserva entradas, cobertura y advertencias, distingue estimado de confirmado. Detección de **anomalías** (conversiones con gasto sin resultado, tasa imposible, gasto superior al autorizado, datos que retroceden): una discrepancia de gasto relevante **bloquea el escalamiento**.

### D-7. Optimización autorizada y versionada; el escalamiento no es automático *(Nivel A — §16, §17, §19, §24, §25)*

El motor de optimización **determinista** traduce evaluación + atribución + anomalías en una decisión explicable (mantener / esperar datos / pausar / escalar / replanificar…) con precondiciones, evidencia mínima, riesgo, reversibilidad y política. La decisión **propone**; su efecto pasa por el **motor de autorización operacional** (única puerta al efecto) y se aplica como **cambio versionado del plan** por el **contrato público** de marketing (`aplicarOptimizacion`). El **escalamiento requiere aprobación** (no automático); una anomalía de gasto lo bloquea. Los experimentos A/B usan reglas deterministas y no declaran ganador sin el mínimo de observaciones.

## Consecuencias

- SOEC **cierra el lazo**: no solo ejecuta marketing — observa el resultado, comprende la calidad de la evidencia y modifica autónomamente su operación **dentro de límites autorizados**, con trazabilidad completa desde la métrica hasta el cambio de plan.
- Se preservan intactos: propósito raíz, soberanía transformada, no-vinculación del conocimiento, y los guardarraíles de ningún gasto/publicación real y modo real desactivado.
- Se habilita F2-CTRL-01 (centro de control) → F2-PILOT-01 (piloto real acotado). El primer efecto externo real sigue siendo **causal de parada** hasta la decisión estratégica de empresa/plataforma/cuenta/presupuesto/nivel/pausa/ventana/criterios.

## Trazabilidad

ADR-0009 (autorización; única puerta al efecto) · ADR-0010 (plan/actividades; contrato de cambio) · ADR-0011 (contenido/variantes) · ADR-0012 (publicaciones y referencias externas) · Const. v1.7 Art. 2.1/2.4 · Principio de Evaluabilidad (la ausencia de información no es conclusión). La medición no revisa el propósito raíz (2.2) ni toca la capa congelada.
