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

## Ámbito sensible del callback de `usar(fn)` (normativo — F-5, M4-BH)

`SecretoResuelto` protege el valor **antes** de entregarlo al consumidor: es opaco en toda serialización, log, reflexión y clonación (privacidad real de ECMAScript, `#valor`). Pero **dentro de `usar(fn)` el valor está en claro**, y ese callback pertenece a la **frontera privilegiada del adaptador**. Es la única superficie donde el valor es legible, y su uso correcto es una obligación normativa, no una recomendación.

El callback de `usar(fn)` **no puede**:

- retornar el valor (ni una estructura que lo contenga);
- persistirlo (event store, base, caché, disco);
- incluirlo en eventos, respuestas de API, métricas o trazas;
- registrarlo (logs) ni incorporarlo a mensajes de error/excepciones;
- conservarlo fuera del scope estrictamente necesario para la operación.

**El resultado de `usar(fn)` nunca debe ser el secreto ni una estructura que lo contenga.** El resultado esperado es siempre un producto NO secreto (una firma, un encabezado ya construido, un booleano, un efecto de red ya ejecutado).

Límites explícitos de la protección (honestidad de capacidades):

- JavaScript **no garantiza** el borrado físico inmediato de la memoria del valor; la protección es **arquitectónica, de alcance y de revisión**, no criptográfica.
- Como defensa adicional, `usar(fn)` **rechaza el caso identidad** (`usar(v => v)` lanza `FugaDeSecretoError`). Esto **sólo** cubre la igualdad exacta con un string: un objeto, una codificación o una excepción podrían ocultar el valor y **no** serían detectados. No debe interpretarse como una barrera completa contra la exfiltración.
- La responsabilidad principal permanece en la **frontera privilegiada** (el adaptador consumidor) y sus **pruebas específicas de no-filtración**. Los adaptadores reales de M4-C deben incorporar revisión y tests dedicados de no-filtración antes de manejar secretos reales, y heredar el estándar de encapsulación del adaptador sintético (campo privado real + representación redactada; F-1).

## Alcance diferido a M4-C (F-4)

Revocación, expiración y eliminación lógica de referencias **forman parte del ciclo operativo de M4-C** y deberán implementarse **antes** de utilizar secretos reales. No se implementan en M4-B/M4-BH para no inventar superficie sólo para satisfacer la auditoría; se registran aquí como **requisito de M4-C**, no como deuda indefinida.

## Verificación

`@soec/secretos` (tras M4-BH): suite ampliada — redacción del holder + guarda identidad (F-5); adaptador con encapsulación real y ausencia de fuga en toda superficie de inspección/reflexión (F-1); gobernanza sólo-referencias + rechazo de secreto en claro + multi-tenant + eventos sin valor; replay/idempotencia/auto-reparación del índice (F-3); neutralidad reforzada como guardarraíl con strip de comentarios + primitivas de red/no-determinismo + especificadores de SDK (F-2). Gate completo verde: typecheck + lint + tests globales.
