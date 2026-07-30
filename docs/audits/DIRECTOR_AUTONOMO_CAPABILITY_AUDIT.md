# Auditoría de capacidades — Director de Marketing Autónomo

> **Fase de discovery (2026-07-25).** Clasificación **basada en evidencia** del código actual
> (rama `feat/director-marketing-autonomo-v1`, sobre `938dd54`). No se implementó nada nuevo en
> esta fase. Vocabulario de estado: `NO EXISTE · DOCUMENTADA · DISEÑADA · INTERFAZ · MOCK ·
> SIMULADA · PARCIAL · FUNCIONAL LOCAL · INTEGRADA · OPERATIVA CONTROLADA · PRODUCTIVA`.
> **Regla:** no se usa «completa» sin evidencia funcional; todo efecto externo hoy es
> **simulado/emulado** (13 archivos con guardarraíl «modo real inalcanzable / SIMULATED»).

## Estructura del repositorio (evidencia)
- Monorepo pnpm **activo**: `apps/{api,web,worker}` (109 archivos de código) + **20 packages**
  (352 archivos). `pnpm-workspace.yaml` = `packages/*`, `apps/*`.
- Dirs `backend/ frontend/ experiments/ resources/ tools/ tests/ temp/`: **scaffolding vacío**
  (1 archivo, 0 de código cada uno). No hay implementación paralela.
- Persistencia: event-sourcing (`@soec/event-store` in-memory + Pg), migraciones `0001…0013`.

## 1. Dirección (objetivos, políticas, límites, presupuesto, autonomía, planes, estrategia, hipótesis)
| Capacidad | Estado | Evidencia | Limitaciones / Brecha | Prioridad |
|---|---|---|---|---|
| Objetivos comerciales | FUNCIONAL LOCAL | `@soec/marketing` ObjectiveService; `@soec/estrategia` deriva candidatos; `@soec/decision` los gobierna (10 archivos «objetivo») | Objetivo estratégico ↔ decisión de marketing no unificados en una entidad | Alta |
| Políticas / autorización | FUNCIONAL LOCAL | `@soec/operacional` PolicyService (política→autorización→ejecución) | — | Media |
| Presupuesto | PARCIAL / SIMULADA | plan de `@soec/marketing`; `@soec/piloto` budget con `ejecutadoReal=0` (4 archivos) | Sin control de gasto real ni límites que bloqueen acción | Alta |
| Nivel de autonomía (N0–N5) | DISEÑADA / PARCIAL | 3 archivos mencionan autonomía; Modelo Operativo fija «autonomía inicial N1» | **No existe** un motor configurable de niveles por empresa/canal/acción | Alta |
| Planes | FUNCIONAL LOCAL (simulado) | `@soec/marketing` PlanningService (objetivo→plan versionado→actividades) | Efectos simulados | Media |
| Estrategia | FUNCIONAL LOCAL | `@soec/estrategia` (señal→mapeo→candidato; contrato PROPUESTA/ABSTENCIÓN) | Solo rubro Clínica Dental | Media |
| **Hipótesis** | **NO EXISTE** | grep `hipotesis` = 0 archivos | Entidad ausente; requerida por el ciclo | **Crítica** |

## 2. Conocimiento (empresa, producto, marca, público, precios, competidores, mercado, evidencia)
| Capacidad | Estado | Evidencia | Limitaciones / Brecha | Prioridad |
|---|---|---|---|---|
| Conocimiento por rubro (sector) | FUNCIONAL LOCAL | `@soec/rubros` v1.1 (Gate G1, huella SHA-256, señales/mapeos), 9 tests | Es conocimiento **sectorial**, no de instancia | Media |
| Comprensión / diagnóstico | FUNCIONAL LOCAL | `@soec/diagnostico` (hechos/faltantes/contradicciones con confianza), 4 tests | — | Media |
| Marca / Producto | PARCIAL | términos «Marca» (26), «Producto» (41) dispersos en marketing/contenido | No hay SSOT de conocimiento de **negocio** con `id/organizacionId/origen/confianza/trazabilidad` | **Crítica** |
| **Público / Audiencia** | **NO EXISTE** | grep `publico\|audiencia\|segmento` = 0 | Entidad ausente | **Crítica** |
| **Competidor / Mercado** | **NO EXISTE** | grep `competidor\|competencia` = 0 | Entidad ausente | Alta |
| Evidencia comercial | PARCIAL | evaluabilidad/faltantes (12 archivos) modelan evidencia diagnóstica | No hay tipología de evidencia comercial reutilizable por decisión | Alta |

## 3. Creación (campañas, contenido, copy, imágenes, video, correo, páginas)
| Capacidad | Estado | Evidencia | Limitaciones / Brecha | Prioridad |
|---|---|---|---|---|
| Campañas | SIMULADA / PARCIAL | plan de `@soec/marketing` con campañas (6 archivos «campania») | No derivan de una decisión con hipótesis; aisladas del ciclo | Alta |
| Contenido (fábrica) | FUNCIONAL LOCAL | `@soec/contenido` (brief→pieza→adaptaciones→validación→paquete), 5 tests | **Sin generación real** (determinista, sin IA) | Media |
| Copy / Imágenes / Video | NO EXISTE | sin generación de texto/imagen/video por IA | Fuera del V1 controlado; requerirá integración externa aprobada | Baja (V1) |
| Landing pages / embudos | NO EXISTE | — | — | Baja (V1) |

## 4. Ejecución (canales, calendario, publicación, anuncios, aprobaciones, reintentos, cancelación)
| Capacidad | Estado | Evidencia | Limitaciones / Brecha | Prioridad |
|---|---|---|---|---|
| Publicación controlada | SIMULADA (robusta) | `@soec/canales` + `canal-emulado` (autorización→adaptador→proveedor EMULADO HTTP→verificación→reconciliación; idempotencia, webhooks, rate limit, credenciales por referencia), 5 tests | Modo real **INALCANZABLE por guardarraíl** (por diseño) | Media |
| Canales reales (Meta/Google/…) | NO EXISTE | — | Requiere decisión estratégica + credenciales (detenerse) | Bloqueada |
| Aprobaciones / cancelación / reintentos | SIMULADA | flujo en canales/marketing | — | Media |

## 5. Medición (eventos, métricas, leads, ventas, atribución, costos, retorno)
| Capacidad | Estado | Evidencia | Limitaciones / Brecha | Prioridad |
|---|---|---|---|---|
| Ingesta→indicadores→atribución | FUNCIONAL LOCAL / SIMULADA | `@soec/medicion` (normalización, dedup, calidad de evidencia, indicadores deterministas, **atribución conservadora**: observación╪atribución╪inferencia, anomalías, optimización versionada), 5 tests | Datos importados/simulados; sin fuente productiva | Alta |
| Distinción métrica importada/calculada/estimada/simulada | PARCIAL | calidad de evidencia en medición | No etiquetada de forma uniforme en toda la cadena | Media |

## 6. Aprendizaje (experimentos, variantes, hipótesis, resultados, conclusiones)
| Capacidad | Estado | Evidencia | Limitaciones / Brecha | Prioridad |
|---|---|---|---|---|
| Optimización versionada | PARCIAL | `@soec/medicion` ajusta el plan (versionado, con aprobación) | Es optimización, no aprendizaje estructurado | Alta |
| **Experimento / variante / conclusión** | **NO EXISTE** | grep `experimento\|variante` = 0 | Store de aprendizaje auditable ausente | **Crítica** |

## 7. Gobierno (trazabilidad, explicabilidad, evaluabilidad, permisos, pausa, modo seguro, auditoría)
| Capacidad | Estado | Evidencia | Limitaciones / Brecha | Prioridad |
|---|---|---|---|---|
| Trazabilidad | FUNCIONAL LOCAL | event-sourcing en todo el arco; snapshots congelados (`@soec/decision`) | — | — |
| Explicabilidad | FUNCIONAL LOCAL (validado en vivo) | F2-DISC (detecté/observé/necesito/me falta + trazabilidad Nivel 4) | Cubre diagnóstico→decisión, no el ciclo completo | Media |
| Evaluabilidad | FUNCIONAL LOCAL | ADR-002; `@soec/diagnostico` (`NO_EVALUABLE`, faltantes) | No es aún un **gate** sobre ejecución de campañas | Alta |
| Permisos / roles | FUNCIONAL LOCAL | `requireRole`, scope permissions | — | — |
| Pausa (interruptor maestro) | FUNCIONAL LOCAL | `@soec/control` (PAUSA real integrada → 0 efectos; lecturas continúan) | Manual; no aún disparada automáticamente por riesgo | Alta |
| Modo seguro automático | PARCIAL | anomalías en medición + reglas del motor | Sin unificar como detención automática por riesgo/incertidumbre/presupuesto | **Crítica** |
| Auditoría integral | FUNCIONAL LOCAL | Centro de Control (`@soec/control`), 3 tests | — | — |
| Director Workspace | FUNCIONAL LOCAL (validado en vivo) | F2-DISC-02/03 (gobierno de decisión, captura real, 545 tests suite) | Cubre diagnóstico→decisión; falta el ciclo de ejecución/medición/aprendizaje | Alta |
| Separación multiempresa | FUNCIONAL LOCAL | filtro por `organizationId`/`comiteId` en todo el arco; aislamiento por evaluación (F2-PILOT-00) | — | — |

## Síntesis honesta
- **Qué funciona (FUNCIONAL LOCAL, con pruebas):** gobierno (trazabilidad, explicabilidad,
  evaluabilidad, permisos, pausa, auditoría, separación multiempresa), el arco F2-DISC
  (rubros→diagnóstico→estrategia→decisión→**Director Workspace**), y los verticales de marketing
  (planificador, fábrica de contenido, medición/atribución).
- **Qué solo parece funcionar / está simulado:** toda la **ejecución externa** (canales/publicación)
  es **emulada**; el modo real es inalcanzable por guardarraíl. Presupuesto y métricas son
  simulados/importados.
- **Qué NO existe (brechas críticas para el V1):** (1) **conocimiento de negocio de instancia**
  gobernado (Organización/Marca/Producto/**Público**/**Competidor**/Evidencia con SSOT y
  trazabilidad); (2) **Hipótesis** como entidad; (3) **Experimento/Aprendizaje** estructurado;
  (4) **entidad de decisión de marketing** rica (objetivo/contexto/hipótesis/alternativas/
  justificación/resultado) — hoy `@soec/decision` gobierna el *objetivo estratégico*, no la
  decisión de campaña; (5) **motor de niveles de autonomía** configurable; (6) **modo seguro
  automático** unificado; (7) **cableado del ciclo cerrado** objetivo→decisión→campaña→ejecución
  →medición→aprendizaje→nueva decisión en **un** flujo gobernado (hoy son verticales separados).
- **Qué se puede reutilizar (no reconstruir):** event-store, evaluabilidad/diagnóstico, estrategia,
  decisión (como base del modelo de decisión), contenido, canales emulados, medición, control/pausa,
  Director Workspace. El V1 **completa y conecta**, no crea motores paralelos.
- **Deuda técnica registrada:** proyección/read-model de evaluación se recompone por request
  (~2 ms a 8 preguntas, sin medir a escala); `PRE-FLIGHT-REPORT.md` ignorado por generado.

## Deriva estratégica evitada
El repo **no** es un ERP genérico ni una colección de herramientas: el arco F2-DISC ya impone el
ciclo de dirección. La brecha principal no es «más herramientas», sino **conectar las capacidades
existentes en un ciclo cerrado gobernado por decisión + evidencia**, y añadir las entidades que hoy
faltan (conocimiento de instancia, hipótesis, experimento, autonomía, modo seguro automático).
