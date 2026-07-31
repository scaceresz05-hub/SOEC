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
