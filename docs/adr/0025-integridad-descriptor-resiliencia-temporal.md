# ADR-0025 — Integridad del descriptor y resiliencia temporal de adaptadores (M4-C-C)

- **Estado:** Aceptado (tramo M4-C-C; en curso).
- **Fecha:** 2026-08-02.
- **Gobernado por:** Directiva Maestra PCE (Título I; **no** se modifica). Se apoya en M4-A/M4-B/M4-C-A-H/M4-C-B(-H).

## Contexto

La reauditoría de M4-C-B-H dejó tres deudas coherentes, cuyo cierre prepara la gobernanza local **antes** de incorporar un SDK/proveedor real (que este tramo **no** introduce):

- **F-CBH-1:** `soportaReal` se leía de una **instancia mutable** (monkey-patchable).
- **F-CB-3:** los gates no se **reevaluaban entre reintentos** con espera temporal.
- **F-CB-4:** `SEMIABIERTO` no garantizaba una **única prueba** concurrente.

## Decisión

### Descriptor registrado e inmutable (F-CBH-1)

`DescriptorAdaptador` es la **autoridad de las capacidades declaradas** (`soportaSimulado/soportaReal/soportaHealthCheck/soportaCancelacion/soportaTimeout`), con `descriptorVersion` y una **huella canónica determinista** (hash FNV-1a sobre serialización con claves ordenadas; reordenar propiedades **no** cambia la huella; cambiar `soportaReal` **sí** cambia huella y versión). Se registra por evento en el **mismo agregado** operativo (no una segunda SSOT), se reconstruye **profundamente congelado**, y `soportaReal` se obtiene del **descriptor persistido**, nunca de la instancia. La instancia ejecutora se valida contra el descriptor (`validarInstanciaContraDescriptor`) y **no puede ampliar** las capacidades declaradas; un monkey-patch de la instancia **no** habilita REAL. Habilitar `soportaReal` exige nueva versión del descriptor + acto humano, y **no** activa el modo REAL automáticamente.

### Coherencia registro ↔ descriptor ↔ implementación ↔ capacidad

Antes de ejecutar deben coincidir `adaptadorId`, `capacidadId`, `implementacionVersion` (registro/descriptor/instancia/capacidad según aplique). REAL exige, en cadena: registro `REAL`+`AUTORIZADO` → `descriptor.soportaReal===true` → instancia coherente con el descriptor → resto de gates canónicos. Una contradicción produce `INCOMPATIBLE`/`NO_AUTORIZADO` **antes** del sandbox.

### Reevaluación de gates entre reintentos (F-CB-3)

Cuando hay **espera temporal** entre intentos, antes de cada nuevo intento se **reevalúan** los gates con el instante y el registro vigentes: tenant, existencia, `AUTORIZADO`, modo, revocación, expiración, eliminación, reemplazo, descriptor vigente, compatibilidad, salud, breaker, cancelación y concurrencia. **No** se reutiliza el veredicto anterior. Cada detención registra el **gate concreto** que la causó. El backoff usa una abstracción neutral `ProgramadorEspera` (inmediato/controlado/grabado); el timer real vive en un archivo-frontera opt-in deshabilitado por defecto, con cancelación y sin red.

### Single-probe en SEMIABIERTO (F-CB-4)

Un `CoordinadorSemiabierto` local otorga un **lease** único por `organizationId+adaptadorId`: un segundo intento concurrente en `SEMIABIERTO` → `NO_DISPONIBLE`. El lease se libera SIEMPRE (éxito/fallo/cancelación/timeout/excepción, idempotente); un lease expirado es recuperable; aislado por organización. Orden: gate breaker → adquirir lease (si SEMIABIERTO) → adquirir concurrencia → ejecutar → liberar concurrencia → actualizar breaker → liberar lease; ningún recurso se conserva si otro no se obtiene. **Es garantía de PROCESO ÚNICO** (no distribuida).

### Evidencia v3

`EvidenciaOperativa` v3 añade `descriptorVersion`, `descriptorHuella`, `implementacionVersion`, `maxIntentos`, `backoffAplicadoMs`, `gateReevaluado`, `breakerEstadoAntes/Despues`, `leaseSemiabierto`. `EvidenciaIntentoAdaptador` (versionada) permite reconstruir **cada intento** de forma independiente; los intentos no se duplican por replay/idempotencia. Nada de secreto/secretRef completa/stack/cause/mensaje original/proveedor comercial.

## Consecuencias

- (+) La autorización REAL deja de depender de una instancia mutable; la resiliencia temporal reevalúa gobierno entre intentos; SEMIABIERTO admite una sola prueba en el proceso.
- (−) Lease, breaker y semáforo son **en memoria (proceso único)**: coordinación distribuida queda como deuda. No se incorpora SDK/proveedor/secret store real, smoke real, costeo ni fallback real.

## Límites del enforcement en memoria (deuda posterior)

Lease/circuit breaker/semáforo distribuidos, métricas productivas, primer SDK real, secret store productivo, smoke real, costeo real, fallback real entre proveedores. **No** puede quedar como deuda: descriptor mutable como autoridad, gates sin reevaluar en retries temporales, más de un probe SEMIABIERTO en el proceso, recursos sin liberar, tenant mezclado.
