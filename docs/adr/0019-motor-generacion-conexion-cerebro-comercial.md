# ADR 0019 — Motor de Generación Autónoma de Marketing: conexión del cerebro comercial (Macrobloque 3)

Estado: ACEPTADO (fundación; en construcción incremental)
Fecha: 2026-07-31
Relacionado: 0011 (fábrica de contenido), 0012 (canales), 0016 (decisión), 0018 (cerebro comercial),
`@soec/crm-comercial`, `@soec/negocio`, `@soec/marketing`, `@soec/contenido`, `@soec/programas`.

## Contexto y hallazgo (auditoría de reutilización)

El "motor de generación" y el **flujo end-to-end simulado ya están construidos**: generación de contenido
tras un puerto neutral (`@soec/contenido` `ProveedorGenerativo` + adaptador determinista), planificación/
calendario/presupuesto (`@soec/marketing`), campañas gobernadas + gate de evaluabilidad + aprobación
humana (`@soec/campanias`, `@soec/decisiones-mkt`, `@soec/contenido-gobernado`), ejecución simulada
(`@soec/ejecucion-simulada`, `@soec/canales` + emulado), medición simulada (`@soec/medicion`), aprendizaje
canónico (`@soec/aprendizaje`), gobernanza/pausa (`@soec/autonomia`), y **orquestadores end-to-end**
(`@soec/piloto-director-v1`, `@soec/programas` `CicloProgramaService`). La neutralidad (sin proveedores
reales) está impuesta por tests de arquitectura; `real_desactivado`/`AUTONOMOUS_REAL` bloqueados.

**Por tanto el Macrobloque 3 NO reimplementa el motor** (sería un segundo sistema). El hueco real es la
**CONEXIÓN**: hoy el ciclo arranca de *fixtures* (`decisionSmileFlow`, `cuerpo` de contenido hard-coded)
y el **cerebro comercial del M2 (`@soec/crm-comercial` + `@soec/negocio`) está huérfano** (sin consumidores
fuera de tests).

## Decisión

Nuevo paquete **`@soec/estrategia-creativa`** que **conecta** el conocimiento comercial con el pipeline
existente, sin duplicarlo. Deriva, de forma determinista, gobernada y **evaluable**, las entradas que el
pipeline ya sabe consumir, y añade el único artefacto creativo faltante:

1. **BriefComercial** derivado del conocimiento comercial (`ConocimientoComercialService`: EMPRESA/PRODUCTO/
   SERVICIO/CLIENTE_IDEAL/COMPETIDOR/MERCADO con procedencia + cobertura) → mapea hacia
   `@soec/marketing.ContenidoObjetivo`/`ContextoOrganizacion` y hacia `@soec/contenido.ContenidoBrief`.
2. **EstrategiaCreativa** (concepto/ángulo/gancho/mensajes clave/tono) — artefacto de primera clase,
   event-sourced, que hoy NO existe (paso propio entre objetivo y pieza).
3. Poblar `@soec/programas` `Programa.segmentos`/`hipotesis` desde `@soec/crm-comercial` (ICP + hipótesis
   comerciales) en lugar de configurarlos a mano.

### Principios (Evaluabilidad + neutralidad + gobernanza)

- **Evaluabilidad:** la derivación es una unión discriminada `PROPUESTA | ABSTENCION`. Si el conocimiento
  comercial es insuficiente (baja cobertura, campos clave faltantes), **abstiene** con sus faltantes; no
  inventa un brief. Reutiliza `coberturaDe` de `@soec/crm-comercial` y `Faltante`/`TipoEvidencia` de negocio.
- **Determinista y sin proveedores reales:** la estrategia creativa V1 es determinista (plantillas), o
  detrás del `ProveedorGenerativo` neutral cuando se genere copy; **jamás** se nombra OpenAI/Anthropic/Meta/
  Google en el dominio (test de arquitectura con SDK prohibidos, como en `@soec/contenido`).
- **Gobernanza preservada:** este paquete produce **borradores/insumos**, no efectos. La aprobación humana,
  el gate de evaluabilidad, los modos (`AUTONOMOUS_REAL` bloqueado) y la ejecución simulada siguen viviendo
  en los paquetes existentes aguas abajo. Intención≠estado.
- **Multi-tenant y trazabilidad:** event-sourced por `organizationId`; cada dato deriva del conocimiento
  con procedencia navegable.

### Orquestación

La conexión se cablea sobre el orquestador **config-driven** `@soec/programas` `CicloProgramaService`
(no sobre el `piloto-director-v1` basado en fixtures): el `Programa` de una organización real se puebla
desde el cerebro comercial, y el ciclo existente (decisión→campaña→contenido→autorización→ejecución sim→
medición→experimento→aprendizaje) corre sobre datos reales.

### Fuera de alcance (macrobloques posteriores)

Adaptador de IA real, conectores reales (Meta/Google/…), correo/WhatsApp, gasto, publicación real,
ejecución/autonomía real. Cierre generativo del lazo (aprendizaje→nuevas campañas) y optimización en lazo
quedan declarados como continuación (no en esta rebanada).

## Consecuencias

- (+) El cerebro comercial deja de estar huérfano; el flujo corre sobre conocimiento real, no fixtures.
- (+) Reutiliza todo el motor y la gobernanza existentes; no crea un segundo sistema.
- (−) Coexisten dos linajes (fábrica autónoma vs Director gobernado) y dos capas de ejecución/medición; su
  unificación se declara como deuda, no se fuerza aquí.
- (−) Colisión de nombre `negocio` (`@soec/negocio` vs dominio interno `negocio` de `@soec/programas`): se
  desambigua por import explícito.

## Validación

Tests unitarios (derivación pura), integración (servicio event-sourced), aislamiento multiempresa,
explicabilidad/evaluabilidad (abstención con faltantes), y test de arquitectura (SDK de proveedores
prohibidos). Sin push/PR/merge hasta autorización.

## Decisiones arquitectónicas de la corrección post-auditoría

### B-2 — SSOT de aprobación

Coexisten dos mecanismos: el nuevo `AprobacionService` (`domain/aprobacion.ts`) y los estados de
`@soec/contenido-gobernado` (`APROBADO/RECHAZADO`). **Decisión:** son capas distintas, no dos autoridades
en conflicto.

- **`AprobacionService` = SSOT de la DECISIÓN HUMANA transversal y versionada** sobre cualquier recurso del
  motor (estrategia/campaña/pieza/variante/entrada de calendario), ligada a `recurso + versión`, con actor
  registrado. Es el **gate** que consulta el orquestador antes de ejecutar y el calendario antes de programar.
- **`@soec/contenido-gobernado` = estado LOCAL del contenido** en su máquina editorial (BORRADOR→…→
  PUBLICADO_SIMULADO), derivado del avance del ciclo, NO la autoridad de la decisión humana.

Regla de no-duplicación: ninguna etapa ejecuta/publica consultando únicamente el estado local; el gate
canónico (`AprobacionService.estaAprobada`/`aprobadaVigente`) es condición necesaria (ver B-4). Unificar
completamente ambos (derivar el estado local de la decisión canónica) queda como deuda declarada, no forzada.

### B-3 — Frontera de calendario

Coexisten `@soec/marketing.Calendario` (planificación estratégica de actividades) y el nuevo calendario
editorial de M3 (`domain/calendario.ts`). **Decisión — frontera explícita:**

- **`@soec/marketing.Calendario` = planificación estratégica** (actividades del plan de marketing).
- **Calendario editorial de M3 = programación OPERATIVA de piezas/variantes generadas** por el motor, con su
  gate de aprobación canónico (B-4) y naturaleza SIMULADO.

No representan la misma entidad; no se fusionan. Si en el futuro la frontera se difumina, se converge; por
ahora se mantienen separados con esta frontera documentada.

## Estado de entrega (tramos D–L)

Cerrado end-to-end sobre datos reales (sin fixtures en el flujo nuevo), todo SIMULADO:

- **D** — Artefacto de estrategia creativa de 1.ª clase, versionado, con afirmaciones ligadas a evidencia
  (sin inventar prueba social).
- **E/F** — Variantes A/B (una sola variable, constantes compartidas) y calendario editorial integrados al
  orquestador.
- **G** — Aprobación humana granular por recurso+versión: una versión nueva no hereda la aprobación
  (modificar invalida la previa); aprobar un recurso no aprueba a otro; registra al actor; RECHAZADA revoca.
- **H** — Orquestador en etapas explícitas y reconstruibles: `prepararPrograma` → gate → `ejecutarSimulado`.
  Sin aprobación humana, se detiene en `PENDIENTE_APROBACION`; el atajo `generarPrograma` usa un helper de
  piloto claramente separado que firma como actor humano (nunca autoaprobación dentro de `ejecutarSimulado`).
- **I** — Recuperación ante fallos parciales: un reintento tras un fallo de la tienda completa el flujo sin
  duplicar (idempotencia de grano fino: reusa campaña/pieza; A/B y calendario idempotentes por id).
- **J** — Superficie HTTP autenticada (`/generation/*`) dentro del gateway M1: sesión→401, membresía→404,
  permiso atómico→403; permisos nuevos en el modelo canónico (`generation.*`, `creative.read`,
  `content.read`, `experiment.read`, `calendar.*`, `execution.simulate`); rechazo de modo real
  (AUTONOMOUS_REAL→422); rate limiting (429); CSRF/límite de payload heredados; auditoría por event-sourcing.
- **K** — UI `/director-autonomo/programas/[programaId]/generacion`: opera el motor y muestra
  REAL/SIMULADO/ESTIMADO/DESCONOCIDO; sesión en cookie httpOnly (sin tokens en el cliente).
- **L** — Caso SmileFlow reproducible: semilla sintética (3 segmentos, 3 hipótesis, 3 estrategias, 3
  campañas, 6 piezas, 2 variantes/campaña, 1 calendario, aprobaciones con actor, ejecución simulada +
  métricas + aprendizajes). Destruible y recreable; determinista.
