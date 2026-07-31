# ADR 0018 — Cerebro Comercial / CRM Inteligente (Macrobloque 2)

Estado: ACEPTADO (fundación; en construcción incremental)
Fecha: 2026-07-31
Relacionado: ADR-005 (auth/multi-tenant), 0016 (decisión institucional), 0017 (divulgación
progresiva), `@soec/negocio`, `@soec/estrategia`, `@soec/decisiones-mkt`, `@soec/aprendizaje`.

## Contexto

El objetivo obligatorio de SOEC es un **Director de Marketing Autónomo**. El Macrobloque 2 construye
su **memoria estratégica / cerebro comercial**: el conocimiento permanente, estructurado y
**explicable** que necesita para operar empresas reales (como SmileFlow), **sin ejecutar todavía**
campañas, canales, gasto ni integraciones externas (eso es un macrobloque posterior).

Regla del bloque: **modelo de conocimiento primero, no pantallas**; **reutilizar, no duplicar**.

## Mapa de lo que YA existe (auditoría previa, no se duplica)

| Capacidad | Dónde vive | Se reutiliza |
|---|---|---|
| Almacén de conocimiento por empresa, event-sourced, multi-tenant | `@soec/negocio` (`ItemConocimiento`, `Faltante`) | Vocabulario epistémico y patrón de store |
| Taxonomía de evidencia + confianza no decorativa | `@soec/negocio` (`TipoEvidencia`, `Confianza`, `confianzaPorDefecto`) | **Importado como canon** |
| "Recomendación explicada" (detecté/observé/necesito/meFalta + factores de confianza + ABSTENCIÓN) | `@soec/estrategia` (`CandidatoEstrategia`, `ResultadoEstrategia`) | Patrón de forma (acoplado a rubro → se generaliza aquí) |
| Hipótesis + alternativas con razón de descarte + `esEvaluable` | `@soec/decisiones-mkt` | Patrón de forma |
| Aprendizaje en 4 capas (por qué funcionó/fracasó) | `@soec/aprendizaje` | Enlace por id |
| Perfil comercial de instancia, `Segmento`, `Hipotesis` de programa | `@soec/programas` | Enlace por id |
| EventStore multi-tenant + streams de índice + composición de migraciones | `@soec/contracts`, `@soec/event-store`, patrón `@soec/programas` | Patrón técnico |
| Autenticación, membresía, gateway autoritativo | `@soec/identity`, `apps/api` (ADR-005) | Tenant y contexto |

## Huecos reales (lo que este bloque construye)

1. **CONTACTO/CLIENTE individual con scoring** — no existe nada. Es el corazón del "CRM inteligente".
2. **Esquemas tipados** para producto, servicio, cliente ideal (ICP), competidor, mercado y perfil de
   empresa (hoy son `Record<string,string>` libres en `@soec/negocio`).
3. **Recomendación explicada como contrato reutilizable** fuera de `@soec/estrategia` (que está
   acoplado a conocimiento de rubro).
4. **Ciclo cerrado hipótesis → evidencia → resultado → aprendizaje** en un mismo agregado.

## Decisión

Se crea el paquete **`@soec/crm-comercial`** (event-sourced, multi-tenant, TS estricto), estructurado
en capas `domain/` (funciones puras + agregados) y `app/` (servicios con `RequestContext`). Clona el
patrón técnico de `@soec/programas` (streams por organización + streams de índice para enumerar).

### Principios rectores (Evaluabilidad + Explicabilidad, Constitución §8-9)

- **Ausencia ≠ conclusión.** Toda salida analítica es una **unión discriminada** con rama de
  abstención de primera clase: `{ tipo:'RECOMENDACION', ... } | { tipo:'ABSTENCION', faltantes, motivo }`.
  Nunca se inventa un valor ante información ausente.
- **Confianza solo donde tiene significado** — se reutiliza `Confianza`/`confianzaPorDefecto` de
  `@soec/negocio`; una hipótesis/estimación no lleva confianza como si fuera un hecho.
- **Toda recomendación es explicada**: nunca "recomiendo X" a secas, siempre
  `razones + evidenciaUsada + alternativasDescartadas(con motivo) + confianza(con factores) + queFalta`.
- **Faltantes de primera clase**; **procedencia** navegable (por id de evidencia); **versionado y
  trazabilidad** naturales por event-sourcing (la última versión gobierna, el historial se conserva).
- **Aislamiento multiempresa** por `organizationId` en cada stream; el conocimiento no cruza tenants.

### Agregados del dominio

- **Perfiles comerciales tipados** (`PerfilEmpresa`, `Producto`, `Servicio`, `ClienteIdeal`,
  `Competidor`, `Mercado`): cada campo relevante puede portar su `origen`/`confianza`/`faltante`.
  Se apoyan en la taxonomía de `@soec/negocio` y **complementan** su almacén (no lo reemplazan).
- **Contacto** (persona/lead individual) con historial de **actividad** y **relación** (eventos).
- **Puntaje** multidimensional y **explicable**: probabilidad de compra, valor esperado, interés,
  riesgo, prioridad, actividad, relación — cada dimensión con sus factores, evidencia y confianza.
- **HipótesisComercial**: agregado que ata `hipótesis → evidencia → resultado → aprendizaje`.
- **RecomendaciónExplicada**: contrato de salida (unión RECOMENDACION | ABSTENCION) para el
  "siguiente paso recomendado" y demás respuestas del CRM inteligente.

### Fuera de alcance (macrobloques posteriores)

Meta/Google/LinkedIn/TikTok Ads, correo/WhatsApp real, OpenAI/Anthropic/Gemini, gasto real, campañas
reales, automatización/ejecución real. `AUTONOMOUS_REAL` permanece bloqueado por dominio (ADR-005).

## Consecuencias

- (+) SOEC podrá comprender comercialmente un negocio, almacenar el conocimiento estructurado y
  explicable, generar hipótesis y **recomendar acciones fundamentadas** — sin ejecutar nada real.
- (+) Reutiliza el sustrato epistémico y de seguridad; no crea un segundo sistema.
- (−) Coexisten dos escalas de confianza históricas (`LOW|MEDIUM|HIGH` vs `ALTA|MEDIA|BAJA`); este
  paquete adopta `Confianza` de `@soec/negocio` como canon y mapea donde consuma otras.
- (−) La generalización de la "recomendación explicada" fuera de `@soec/estrategia` se hace por
  contrato local; una futura extracción a `@soec/contracts` queda como deuda declarada.

## Validación

Tests unitarios (dominio puro), de integración (servicios sobre `InMemoryEventStore`), de aislamiento
multiempresa, de explicabilidad (toda recomendación trae razones/alternativas/faltantes), de
**reconstrucción histórica mediante replay** (no rollback transaccional — ver más abajo) y de
auditoría (procedencia). Más pruebas adversariales permanentes de las correcciones post-auditoría.

## Frontera de fuentes de verdad (SSOT) — H-3

`@soec/negocio` es el almacén CANÓNICO de la EXISTENCIA de una entidad comercial y de su evidencia.
`@soec/crm-comercial` es la capa TIPADA/operacional: valida el esquema por tipo, guarda la procedencia
POR CAMPO y calcula cobertura, **referenciando la entidad canónica por el mismo id** (no es una
segunda copia independiente: al registrar una entidad, se asegura su ítem canónico en `@soec/negocio`).

| Concepto | SSOT | Rol del CRM |
|---|---|---|
| Empresa | `@soec/negocio` (ORGANIZACION) | perfil tipado + cobertura, referencia por id |
| Producto | `@soec/negocio` (PRODUCTO) | perfil tipado + procedencia por campo |
| Servicio | `@soec/negocio` (PRODUCTO) | perfil tipado + procedencia por campo |
| Cliente ideal | `@soec/negocio` (PUBLICO) | perfil tipado (ICP) + cobertura |
| Competidor | `@soec/negocio` (COMPETIDOR) | perfil tipado + cobertura |
| Mercado | `@soec/negocio` (MERCADO) | perfil tipado + cobertura |
| Contacto individual | `@soec/crm-comercial` | agregado propio (no existe en negocio) |
| Hipótesis comercial | `@soec/crm-comercial` | agregado propio (ciclo cerrado) |
| **Aprendizaje** | **`@soec/aprendizaje`** | la hipótesis solo guarda `aprendizajeId` (referencia) |

## Semántica de recuperación (aclaración honesta) — H-9 declarada

El event-sourcing provee **reconstrucción histórica mediante replay** (reducción de eventos), no
rollback transaccional ni compensación automática. Hoy NO existen: rollback transaccional multi-stream,
eventos de compensación/anulación, ni eliminación física de eventos. Las operaciones multi-stream
(agregado + índice; entidad crm + ítem canónico en negocio) se hacen **idempotentes y autorreparables**
(consistencia eventual explícita), no transaccionales.

## Correcciones post-auditoría (PR #4)

- **H-1:** una hipótesis no puede CONFIRMARSE/REFUTARSE sin evidencia coherente (`veredictoAdmisible`);
  la contradicción lleva a INCONCLUSA. No se fabrica confianza.
- **H-2:** el APRENDIZAJE vive en su dominio canónico `@soec/aprendizaje`; la hipótesis solo guarda
  `aprendizajeId`. Sin agregado de aprendizaje embebido.
- **H-4:** el scoring usa una **política gobernada y versionada** (`PoliticaScoringComercial`,
  `POLITICA_SCORING_V1`), inyectable; la **confianza deriva de la evidencia** (origen, cobertura,
  contradicción), no del conteo. La salida es HEURÍSTICA y lo declara (`naturaleza`, `politicaVersion`).
- **H-5:** validación antes de persistir (montos ≥0/finitos, sin fechas futuras en actividades,
  límites de texto/colecciones, campos fuera de esquema rechazados).
- **H-6:** inscripción en índices idempotente y autorreparable (nunca deja estado parcial irreparable).
- **H-10:** `HipotesisNoEncontradaError` propio.

### Deuda declarada (no bloqueante)
Trazabilidad navegable por `actividadId` (parcial); read-model paginado a gran escala (índice O(n) por
inserción); privacidad/consentimiento/retención y eventos de anonimización/compensación; convergencia
del vocabulario explicativo con `@soec/estrategia` al extraer el contrato común a `@soec/contracts`.
