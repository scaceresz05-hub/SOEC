# ADR-0022 — SecretStore por referencia (M4-B)

- **Estado:** Aceptado (a la espera de auditoría de M4-B).
- **Fecha:** 2026-08-02.
- **Gobernado por:** Directiva Maestra PCE (`docs/governance/DIRECTIVA-MAESTRA-PCE.md`), **Art. 4** (secretos por referencia). Se apoya en el núcleo de ADR-0021.

## Contexto

El Art. 4 exige que **el dominio nunca lea ni transporte el valor de un secreto**: sólo conoce **referencias opacas** (`env:…`, `vault:…`, …). M4-B materializa esa frontera con un paquete propio, sin conectar todavía ningún proveedor real y sin que valor secreto alguno entre al modelo, a los eventos, a los logs o a las respuestas. Restricción de seguridad del tramo: se trabaja **sólo con contratos, referencias y adaptadores sintéticos**; ninguna prueba realiza llamadas reales; `AUTONOMOUS_REAL` sigue bloqueado.

## Decisión

Paquete nuevo **`@soec/secretos`** (event-sourced, multi-tenant, determinista, **neutral** — sin SDKs/red/entorno/reloj, verificado por test de arquitectura). Tres piezas y una separación tajante entre *gobernar referencias* (dominio) y *resolver valores* (frontera):

- **Caja opaca `SecretoResuelto` (dominio):** guarda el valor en un campo privado `#valor`; el valor **sólo** se accede pasando una función a `usar(fn)`. `toString`/`toJSON`/`util.inspect` están **redactados** — el valor no puede filtrarse por serialización, log ni traza. Tests lo verifican adversarialmente.
- **Gobernanza `RegistroSecretosService` (aplicación):** registra y rota (Art. 7) referencias por `nombreLogico`, event-sourced y aislado por organización (Art. 10). Persiste **sólo metadatos** (`secretRef`, `rotaciones`, `actor`, instante) — **jamás** un valor. Valida toda `secretRef` con el guardarraíl `esReferenciaSecreto` de `@soec/plataforma-capacidades`, rechazando cualquier cosa con **forma de secreto en claro**. Un test lee los eventos crudos y comprueba que no existe campo `valor`.
- **Puerto `SecretStore` + adaptador de frontera:** `resolver(ctx, secretRef) → SecretoResuelto`. El **único** lugar donde existe un valor es el adaptador de frontera. Se entrega `SecretStoreEnMemoria` (sintético, sólo dev/test): recibe un mapa `secretRef → valor de prueba` provisto por el llamador — nunca un secreto real —, valida la referencia y devuelve la caja opaca. Los adaptadores reales (env/vault/aws-sm/…) llegarán en su propia frontera en un tramo posterior.

## Consecuencias

- (+) El Art. 4 queda codificado y verificado: el dominio conoce **referencias**, no secretos; el valor vive sólo tras la frontera y sale sólo por `usar`.
- (+) Base lista para que M4-C (adaptadores reales por proveedor) y M4-D (motor supervisado) resuelvan secretos **sin** que el dominio los vea.
- (−) Sin resolución real todavía: sólo el adaptador sintético. `AUTONOMOUS_REAL` permanece bloqueado; no se conectó proveedor ni canal externo.

## Verificación

`@soec/secretos`: 17 tests (redacción del holder, gobernanza sólo-referencias + rechazo de secreto en claro + multi-tenant + eventos sin valor, adaptador sintético, neutralidad). Gate completo verde: typecheck + lint + 858 tests.
