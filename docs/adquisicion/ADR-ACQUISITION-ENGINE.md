# ADR — SOEC Acquisition Engine (fundación multicanal)

> Estado: **Aceptado (fundación + shadow)**. Rama `feat/acquisition-engine-foundation` (base `main` 5a0b415).
> Sin push/PR/merge. `AUTONOMOUS_REAL=false`. Cero efectos externos: no publica, no crea campañas,
> no gasta, no conecta Meta real.

## Contexto

SOEC debe poder recibir un **objetivo comercial** y encargarse progresivamente de **generar demanda y
potenciales clientes** en múltiples canales (Google, Meta/Instagram/Facebook, orgánico, email,
WhatsApp), decidiendo canal, mensaje, contenido, audiencia, inversión (dentro de un mandato),
medición, y cuándo mantener/cambiar/abstenerse/pedir autorización.

La regla de arquitectura es **un motor genérico y multitenant**, no servicios por-empresa
(`MetaSmileFlowService`, etc.). Una tercera empresa debe incorporarse por **configuración**, sin tocar
el core.

## Decisión

Se auditó el monorepo completo antes de escribir código (6 auditorías en paralelo). **Hallazgo
central: ~85% de lo necesario ya existe y es provider-neutral por diseño.** Por tanto NO se construye
un segundo sistema: se crea una capa **unificadora** delgada, `@soec/adquisicion`, que compone los
primitivos probados en el vocabulario que el motor necesita.

### Qué se reutiliza (no se reimplementa)

| Necesidad | Se reutiliza (símbolo · ubicación) |
|---|---|
| Spine tenant/config + tercer negocio por config | `crearResolutorDeNegocios`, `ConfiguracionOrganizacion`, `ModeloDeNegocio` · `apps/api/src/plataforma` (test `THIRD_ORG_CAN_BE_REGISTERED_WITHOUT_CORE_CHANGE`) |
| Motor de autonomía (gates/mandato/ledger/kill/shadow/canary) | `evaluarAccion`, `MandatoAutonomia`, `LedgerEjecucion`, `evaluarSombra` · `@soec/autonomia` |
| Interruptor maestro real | `AUTONOMOUS_REAL`, `assertSimulado` · `@soec/cia` |
| Patrón adaptador read + write **locked** | `GoogleAdsAdapter` / `GoogleAdsWriteAdapter` / `estadoCapacidadWrite` · `apps/api` + `@soec/autonomia/canary` |
| Secretos tenant-scoped por referencia opaca | `SecretStore`, `SecretStoreArchivo` (`file:<org>/…`) · `@soec/secretos` |
| Fundamentos / FOUNDATION_REQUIRED | `evaluarFundamentos`, `VeredictoFundamentos` · `apps/api/src/plataforma/fundamentos.ts` |
| Estado de canal / cuenta externa | `EstadoFuente`, `CuentaExternaRef` · `plataforma/tipos.ts` |
| Campaña gobernada + decisión con evidencia | `Campania` · `@soec/campanias`; `DecisionMkt`/`CandidatoEstrategia` · `@soec/decisiones-mkt`/`@soec/estrategia` |
| Contenido/creativo + marca + claims | `ContenidoBrief`, `ContenidoMarca`, `validarContenidoComercial` (PROMESA_CLINICA…) · `@soec/contenido`, `@soec/contenido-gobernado`, `@soec/estrategia-creativa` |
| Outcome/atribución/economía honesta | `EventoWebTipo`, `Atribucion`/`GradoAtribucion`, `calcularIndicador`, `DesconocidoOValor` · `@soec/comercio`, `@soec/medicion`, `@soec/motor-medicion` |
| Aislamiento de test/diagnóstico | `ProvenanciaReal.diagnostico` · `@soec/motor-medicion` |

### Qué es genuinamente nuevo (lo que aporta `@soec/adquisicion`)

Capa **unificadora** provider-neutral (pura, sin red/reloj/efectos), que da el vocabulario que faltaba:

- `CanalAdquisicion` (enum tipado) + `EstadoCanal` (con eje SHADOW/REAL) + `CuentaCanal` tenant-scoped fail-closed.
- `ObjetivoComercial` + resultados válidos por negocio; `ResultadoAdquisicion` (escalera unificada).
- `LeadAdquisicion` (identidad `org+source+externalLeadId`, sin PII, `esTest`) + guardarraíl `contienePII`.
- `EvidenciaAtribucion` + `NivelAtribucion` (DIRECT/OBSERVED/ATTRIBUTED/PROBABLE/UNKNOWN); UNKNOWN permanece UNKNOWN.
- `EconomiaAdquisicion` (CPL/CPQL/CAC/ROAS/MER) con denominadores válidos / DESCONOCIDO.
- `PoliticaMarca` (BrandPolicy) + `PoliticaClaims` por negocio; sin BrandPolicy ⇒ DRAFT_ONLY.
- `HipotesisContenido` (exige evidencia comercial; nunca "publicar porque toca").
- `CampanaAdquisicion` (estados provider-neutral) + `GrupoDistribucion` (≡ Ad Set).
- `AcquisitionExperiment` + `StopLossPolicy`; sin StopLoss ⇒ sin PAID autónomo.
- `DecisionEstrategiaCanal` (canal + por qué + evidencia + confianza) + `planificarAdquisicion` (NO_ACTION/FOUNDATION_REQUIRED/ORGANIC/PAID/MULTICHANNEL/APPROVAL_REQUIRED).
- `EnlaceResultado` (OutcomeLink; confianza derivada de la atribución, nunca al revés).
- Taxonomía de acciones sociales orgánicas/pagadas + clases de riesgo (LOW/MEDIUM/HIGH/CRITICAL); REAL=FORBIDDEN, SHADOW=ALLOWED.
- Contrato de frontera Meta: `MetaReadPort` + `MetaWritePort` con default **fail-closed** (`MetaWriteBloqueado`).

### Frontera con la autonomía existente

La taxonomía de acciones sociales de `@soec/adquisicion` es **especificación**: define tipos, riesgo y
mapeo intrínseco (`reversibilidad × financiera`) para **enchufarse** en `MandatoAutonomia` / `evaluarAccion`
/ ledger / canary ya construidos. No hay segundo motor de autonomía. La conexión del catálogo a la
unión cerrada `TipoAccion` de `@soec/autonomia` y el adaptador real de Meta (que extiende
`AdaptadorRealBase` y resuelve secretos por `SecretStore`) pertenecen al **capítulo de onboarding
read-only** (ver `META-READ-ONLY-ONBOARDING.md`), para no romper el build del monorepo en esta fase.

## Consecuencias

- SOEC puede representar honestamente objetivo, canales conectados/no-conectados, estrategia razonable,
  hipótesis de contenido/campaña, evidencia usada, qué requiere aprobación y qué podría hacer autónomo.
- Todo permanece en SHADOW: `REAL_SOCIAL_PUBLICATIONS=0`, `REAL_META_CAMPAIGNS=0`, `REAL_META_SPEND=0`.
- La escritura Meta es un contrato bloqueado; sin credencial y con `AUTONOMOUS_REAL=false` toda mutación falla cerrada.
- Un tercer negocio se incorpora por configuración (probado en `shadow-demo.test.ts`).
