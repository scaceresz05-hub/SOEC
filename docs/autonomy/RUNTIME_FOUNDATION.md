# SOEC · Fundación del runtime autónomo (Autonomy Fase 0)

**Fecha:** 2026-09-21 · **Alcance:** las cuatro fundaciones que tenían que estar firmes antes de convertir el negocio en dato: ingesta server-side, gobierno de mutaciones externas, aislamiento multi-tenant y observabilidad de los trabajos de fondo. No se implementó onboarding, investigación, creativos ni optimización.

Contexto: [SOEC_AUTONOMY_GAP_AUDIT.md](../auditoria/SOEC_AUTONOMY_GAP_AUDIT.md).

---

## 1. Modos de ejecución — una sola semántica

Antes, `packages/identity` documentaba `SUPERVISED_REAL` como «sin mutación externa» mientras ese mismo modo habilitaba la creación real de campaña. La definición vive ahora en un solo módulo, `apps/api/src/gobierno/modos.ts`, y el resto del sistema la consulta:

| Modo | Valor almacenado | Qué permite |
|---|---|---|
| **OBSERVE** | `PILOT` (y cualquier valor desconocido o nulo) | Lectura real, análisis y recomendaciones. **Ninguna** mutación externa. |
| **SUPERVISED_REAL** | `SUPERVISED_REAL` | Datos y decisiones reales; mutación externa **sólo con autorización explícita vigente** (envelope aprobado para esa acción y ese canal). |
| **AUTONOMOUS_REAL** | `AUTONOMOUS_REAL` | Mutación externa sin aprobación por acción, **sólo dentro de un mandato ya aprobado**. El contrato queda definido y probado; la ejecución completa llega en fases posteriores y el dominio de identidad sigue sin permitir activar el modo. |

La traducción es fail-closed: lo desconocido degrada a OBSERVE (`modoDeOrganizacion`).

## 2. Kill switch — `EXTERNAL_MUTATIONS_ALLOWED`

`apps/api/src/gobierno/kill-switch.ts`. Variable del despliegue `SOEC_EXTERNAL_MUTATIONS`; se acepta `off`, `false`, `no`, `disabled` o `0` para apagarlas. Por defecto están **habilitadas**, y el arranque deja en el log qué postura tiene el despliegue:

```json
{"externalMutationsAllowed":true,"killSwitchDeclarado":null}
```

Cuando está apagado, `evaluarMutacionExterna` deniega **todas** las clases —creación, presupuesto, puja, keywords, anuncios, estado y también la pausa de seguridad— antes de construir ninguna petición. El gate central de ejecución autorizada lo consulta como capa 0 (`EXTERNAL_MUTATIONS_DISABLED` en `authorized-execution-envelope.ts`), de modo que el único camino de creación real (canary) también queda cortado. No se puede volver a encender desde una petición HTTP: es del despliegue, no del usuario.

## 3. Safety pause — pausa automática gobernada

Pausar por stop-loss reduce exposición financiera, así que **no depende del modo**: una empresa en OBSERVE puede seguir protegida. Pero tampoco es implícita: depende de que la organización la declare.

- Declaración: `politicaSeguridad: { pausaAutomatica: true }` en el registro del negocio (`apps/api/src/plataforma/tipos.ts`). Hoy sólo la declara **SmileFlow**, que conserva exactamente la protección que ya tenía.
- Resolución: `evaluarPausaSeguridad(org, env)` combina kill switch + política declarada.
- Ejecución: `StopMonitorService` consulta el gobierno **antes** de tocar al proveedor. Sin permiso: cero escrituras, `outcome: 'SAFETY_PAUSE_DENIED'` y el motivo persistido junto a la decisión (organización, campaña, reglas disparadas, métricas observadas, timestamp y resultado ya se registraban).
- Fail-closed: un monitor sin gobierno inyectado **no pausa** (`SAFETY_PAUSE_NOT_GOVERNED`).

Una organización sin política declarada —CP Odontología, por ejemplo— no recibe ninguna acción.

## 4. Ingesta server-side multiempresa

`apps/api/src/ingesta/ingesta-runtime.ts`, arrancada desde `server.ts`.

- **Sustituye** la tarea de Windows `scripts/ingesta-tick.cmd` → `ingest-all.ts`, que corría en el PC de un desarrollador contra un Postgres local, para una organización fijada por `SOEC_INGESTA_ORG`, y llevaba deshabilitada desde el 2026-08-27. Esa tarea **debe permanecer deshabilitada**: el servidor ya hace el trabajo.
- **Descubrimiento**, no configuración fija: recorre el registro de negocios y admite una organización sólo si tiene fuente declarada, su estado permite lectura y su credencial está disponible. Lo que queda fuera se declara con motivo (`omitidas`), nunca en silencio.
- **Aislamiento**: un `SchedulerIngesta` por organización, con su contexto y sus cursores (`ingesta-cursor:<provider>:<org>`). El fallo de una no detiene a las demás.
- **Alcance deliberado**: sólo las fuentes SIN planificador propio. Google Ads queda fuera porque ya tiene su
  scheduler multi-tenant con lease distribuido (cadencia 3 h); repetirlo cada 15 min gastaba cuota de la API
  y devolvía 429 sin aportar datos nuevos. El motivo se declara en `omitidas`, no se calla.
- **Idempotencia intacta**: no se tocó la deduplicación existente (`provider:event_id` + cursor por fuente); un reinicio no duplica datos.
- Cadencia 15 min, primera corrida diferida 30 s tras el arranque, sin solapes. Apagable con `SOEC_INGESTA_ENABLED=false`.
- Reutiliza el scheduler que ya existía: no se construyó otro sistema de trabajos.

El arranque deja constancia de qué organizaciones entraron:

```json
{"ingesta":"started","intervaloMs":900000,"organizaciones":[{"org":"org-cp-odontologia","fuentes":["src-cp-odontologia-growth"],"omitidas":["google-ads: sin fuente declarada"]}]}
```

## 5. Aislamiento multi-tenant

Dos fugas que la auditoría confirmó, cerradas:

1. `GET /plataforma/negocios` devolvía **todas** las organizaciones del registro a cualquier usuario autenticado (`filtradoPorMembresia: false`). Ahora se acota a la organización del contexto —que el gateway resolvió contra la membresía— y responde `filtradoPorMembresia: true`. Quien pertenece a varias empresas las ve por el plano de identidad (`/auth/me`, `/organizations`).
2. Las rutas de programas (`/experience/director-autonomo/organizaciones/...`) tomaban la organización de la URL o del cuerpo. Ahora la autoridad es siempre el contexto autenticado (`exigirOrganizacion`, en `superficie-auth.ts`): una organización ajena responde **403**, y el listado sólo devuelve lo propio.

Los contratos negativos viven en `apps/api/test/aislamiento-tenant-fase-0.test.ts`.

## 6. Salud de los trabajos de fondo

Tabla `job_health` (una fila por trabajo y organización; `organization_id = ''` para los de ámbito de despliegue) y read model `GET /operacion/salud`, acotado al tenant y con permiso `business.read`.

Campos: `lastStartedAt · lastSucceededAt · lastFailedAt · lastError · nextRunAt · enabled`, con el estado **derivado al leer** —nunca persistido, porque envejece solo—:

| Estado | Cuándo |
|---|---|
| `DESHABILITADO` | el trabajo está apagado por configuración (manda sobre todo: no es una avería) |
| `FALLANDO` | su último fallo es posterior a su último éxito |
| `ATRASADO` | `nextRunAt` venció hace más de 3 minutos |
| `OPERATIVO` | corrió y le toca en el futuro |
| `SIN_DATOS` | nunca registró nada |

Cubre `ingestion`, `stopMonitor`, `directorCycle`, `googleAdsScheduler` y `metaScheduler`. La respuesta incluye además la postura de gobierno de la organización: modo, kill switch y si tiene la pausa de seguridad habilitada. La observabilidad nunca puede tumbar al bucle que observa: todo registro de salud va envuelto y su fallo se ignora.

## 7. Qué NO cambió

SmileFlow conserva sus cuatro bucles y su protección de stop-loss; su campaña sigue pausada y nada la reactiva. No se tocó Google Ads, Meta, la web de CP, el esquema de D1 ni el contrato de privacidad de la ingesta. No se introdujo ningún proveedor de IA. `AUTONOMOUS_REAL` sigue sin poder activarse desde el dominio de identidad.
