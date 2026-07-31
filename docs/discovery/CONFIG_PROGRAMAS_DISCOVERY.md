# Discovery — Configuración de Programas de Marketing por Negocio

Rama: `feat/configuracion-programas-marketing-v1` · Base: `main` (`7b45f9c`).
Objetivo del bloque: pasar de un **ciclo autónomo fijo** (1 campaña sintética por org) a poder
**configurar un programa por negocio** (objetivos, segmentos, hipótesis, N campañas, N contenidos,
presupuesto) y operar el ciclo sobre esa configuración, **reutilizando A–J** (sin sistema paralelo).

## Hallazgos transversales (con evidencia)

1. **El EventStore solo expone `readStream(ctx, streamId)`** (`packages/contracts/src/index.ts:149`)
   — NO hay scan por prefijo. La enumeración se resuelve con **stream de índice**, patrón ya
   usado por `@soec/evaluacion` (`EVENTOS_INDICE`, `indiceStreamId(org,dep)`, `reconstruirIndice`
   en `packages/evaluacion/src/domain/evaluacion.ts:310-336`). **Reutilizar este patrón**, no inventar.
2. **Todos los servicios A–J toman `EventStore` inyectado** (constructor `(store: EventStore)`) →
   reutilizables sin cambios desde una capa orquestadora nueva.
3. **Acoplamiento central a ids fijos:** el ciclo reconstruye por `IDS_CICLO = {d1, camp1, cont1,
   exp1, apr1, d2}` (`packages/piloto-director-v1/src/piloto.ts:44`). Esto es lo que impide
   múltiples campañas/programas por org.
4. **Todos los stream ids ya están acotados por organización** (`campania:<org>:<id>`,
   `decmkt:<org>:<id>`, …) → el aislamiento multi-tenant se conserva sin cambios.

## Mapa por área

| # | Área | Archivo · clase/función | Responsabilidad | Limitación actual | Reutilización | Cambio mínimo |
|---|---|---|---|---|---|---|
| 1 | Organización | `apps/api/src/catalogo.ts` (`CATALOGO`); `@soec/negocio` `ConocimientoService` | Catálogo fijo de 3 orgs demo; SSOT de conocimiento de negocio por org | No hay entidad Negocio configurable; catálogo hardcodeado; sin alta por runtime | `@soec/negocio` para el perfil comercial | Nuevo agregado `Negocio` + índice de organizaciones; el selector UI lee del índice |
| 2 | Objetivos | `@soec/decisiones-mkt` `EntradaDecision.objetivo`; `@soec/decision` (objetivo institucional) | Objetivo como campo de la decisión | No hay objetivo de programa con secundarios | La decisión sigue portando su objetivo | `objetivoPrincipal`/`objetivosSecundarios` en el agregado `Programa` |
| 3 | Decisiones | `@soec/decisiones-mkt` `DecisionMktService` · `decmkt:<org>:<id>` | Ciclo de decisión rico (hipótesis, alternativas, evaluabilidad) | No enumerable (sin índice) | **Tal cual** | Índice de decisiones por programa |
| 4 | Campañas | `@soec/campanias` `CampaniaService` · `campania:<org>:<id>` | Campaña gobernada (publico, presupuesto, hipótesis, decisionId) | Sin vínculo a programa/segmento/hipótesis; sin enumeración | **Tal cual** | Campos **opcionales** de vínculo (`programaId?`,`segmentoId?`,`hipotesisId?`) — retrocompatibles; índice por programa |
| 5 | Contenido | `@soec/contenido-gobernado` `ContenidoGobernadoService` · `contenido-gob:<org>:<id>` | Contenido gobernado, N piezas por servicio | Sin enumeración por campaña | **Tal cual** | Índice de contenidos por campaña |
| 6 | Presupuesto | `campania.presupuesto {monto,moneda}` | Presupuesto por campaña | No hay presupuesto de programa ni distribución | El de campaña | `Programa.presupuestoTotalSimulado` + validar Σcampañas ≤ total |
| 7 | Ejecución | `@soec/ejecucion-simulada` `EjecucionService` · `ejec:<org>:<contenidoId>` | Ejecución SIMULADA determinista | — | **Tal cual** | Ninguno |
| 8 | Medición | `@soec/medicion` `evaluarResultadoCampania`, `ClasificacionRoi` | ROI honesto (SIMULADO nunca REAL) | — | **Tal cual** | Ninguno |
| 9 | Aprendizaje | `@soec/aprendizaje` `AprendizajeService` · `aprendizaje:<org>:<id>` | Aprendizaje estructurado 4 capas | Sin enumeración | **Tal cual** | Índice por programa |
| 10 | Autonomía | `@soec/autonomia` `AutonomiaService` · `autonomia:<org>` | Autorización, PAUSA, niveles | Autonomía por **org**, no por programa | **Tal cual** | Decisión ADR: PAUSA por org (actual) vs. por programa |
| 11 | EventStore | `@soec/event-store` `append`/`readStream`; `PgEventStore` | Persistencia event-sourced | Sin scan por prefijo | **Tal cual** | Enumeración vía índices |
| 12 | Reconstrucción | `reconstruir*` por agregado; `reconstruirVistaDirector` (ids fijos) | Reconstruye estado desde eventos | Reconstruye por `IDS_CICLO` fijos | Los `reconstruir*` de cada agregado | Reconstruir por ids del **programa** (desde índices), no fijos |
| 13 | API | `apps/api/src/director-autonomo-routes.ts` (4 endpoints) | estado/ejecutar-ciclo/pausar/reanudar (ciclo fijo) | Sin configuración | El registro `registerDirectorAutonomoRoutes(app,store,clock)` | Nuevos endpoints de configuración + ciclo por programa |
| 14 | UI | `apps/web/app/director-autonomo/page.tsx` | Vista del ciclo fijo, selector del catálogo | Selector fijo; muestra 1 campaña | La página y sus proxies | Selector dinámico + gestión de programas |
| 15 | Seeds/fixtures | `packages/piloto-director-v1/src/fixture.ts`; `apps/api/scripts/seed-piloto.ts` | Fixture SmileFlow fija; seed del workspace viejo | Fixture = única vía de operación | La fixture como **demo/seed** | Mantener la demo; el ciclo deja de depender solo de la fixture |
| 16 | Tests | tests por-paquete + `apps/api/test/director-autonomo-api.test.ts` | Cobertura A–J + cableado | — | **Tal cual** | Añadir tests del nuevo bloque; conservar los del demo |

## Conclusión del discovery

- La enumeración multi-entidad se resuelve con el **patrón de índice existente** (no duplicar).
- Los servicios A–J se **reutilizan sin cambios**; el nuevo bloque es una **capa de configuración +
  índices + orquestación por programa**, no una reimplementación del dominio.
- El único cambio de dominio propuesto es **añadir campos opcionales de vínculo** a la campaña
  (retrocompatible) — a confirmar en la ADR.
- El ciclo fijo (`IDS_CICLO`) se conserva como **demo** hasta que la migración esté aprobada.
