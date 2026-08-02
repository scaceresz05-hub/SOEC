# ADR-0023 — Frontera de Adaptadores Reales (M4-C)

- **Estado:** Aceptado (tramo M4-C-A; en curso).
- **Fecha:** 2026-08-02.
- **Gobernado por:** Directiva Maestra PCE (`docs/governance/DIRECTIVA-MAESTRA-PCE.md`), Título I. Se apoya en el núcleo de capacidades (ADR-0021) y en SecretStore por referencia (ADR-0022 + M4-BH).

## Contexto

M4-C abre la **frontera de adaptadores**: el lugar donde una capacidad externa se ejecuta contra el mundo. Es el primer tramo donde, en el futuro, podrían circular **valores reales**. Por eso arranca con alcance **acotado y neutral**: contratos de adaptadores, sandbox local, adaptadores **fake/grabados**, evidencia reproducible, smoke tests opt-in, health checks, errores normalizados, timeouts y cancelación. **No** se conectan proveedores ni credenciales productivas; ninguna llamada real ocurre en `verify`; `AUTONOMOUS_REAL` sigue bloqueado.

Todo adaptador real, cuando exista, **nace** `DESACTIVADO · SIMULADO · SIN_CREDENCIAL · NO_CONSUMIBLE` y sólo avanza de estado por **actos humanos auditados**, gobernados por el ciclo de vida de la capacidad (M4-A, `esConsumible`) y el registro de secretos por referencia (M4-B). La frontera **no** re-deriva consumibilidad: la consulta a la autoridad única `esConsumible`.

## Decisión

Paquete nuevo **`@soec/adaptadores`** (neutral, determinista — sin SDKs/red/entorno/reloj/aleatoriedad, verificado por test de arquitectura estilo M4-BH). Depende de `@soec/contracts`, `@soec/plataforma-capacidades` (consumibilidad) y `@soec/secretos` (referencias). Piezas del tramo **M4-C-A**:

- **Puerto neutral `AdaptadorExterno`:** `salud(ctx, observadoEn, signal?)` y `ejecutar(ctx, peticion, observadoEn, signal?)`. Conoce su **capacidad lógica**, nunca un proveedor concreto. El instante (`observadoEn`) se inyecta (convención SOEC: sin reloj interno). Soporta **cancelación** por `AbortSignal`.
- **Errores normalizados:** taxonomía cerrada `TIMEOUT · CANCELADO · NO_DISPONIBLE · NO_AUTORIZADO · INVALIDO · LIMITE · DESCONOCIDO`. Los fallos esperados se devuelven como resultado normalizado (no excepción); el mensaje jamás transporta secretos.
- **Estado de frontera del adaptador:** `EstadoAdaptador` (activacion/modo/credencial/consumo + `secretRef` por referencia). Nace en los cuatro estados seguros; `puedeEjecutarReal` exige `ACTIVADO · REAL · CON_CREDENCIAL · CONSUMIBLE`. En M4-C-A todo corre `SIMULADO`.
- **Sandbox local:** ejecuta un adaptador bajo cancelación/timeout, **rechaza** ejecución REAL si la capacidad no es consumible (delegando en `esConsumible` de M4-A), **normaliza** todo error (incluidas excepciones no previstas → `DESCONOCIDO`) y produce **evidencia reproducible**.
- **Adaptadores fake y grabado:** `AdaptadorFake` (respuestas deterministas configurables) y `AdaptadorGrabado` (reproduce evidencia grabada por clave determinista). Ninguno toca red.
- **Smoke tests opt-in:** los smoke deterministas contra fake/grabado corren en `verify` (seguros). El smoke contra **proveedores reales** queda diferido y es opt-in — nunca dentro de `verify`.

## Consecuencias

- (+) Contrato de frontera neutral y verificable sobre el que los adaptadores reales de tramos posteriores se apoyan **sin** tocar el dominio ni ver secretos.
- (+) Cancelación, timeout, salud y errores quedan normalizados y probados con evidencia reproducible antes de conectar nada real.
- (−) Aún no hay ejecución real (sólo fake/grabado). El timer de wall-clock del timeout vive en una capa opt-in diferida; en M4-C-A la cancelación/timeout se modela por `AbortSignal` (determinista en tests).

## Alcance y prohibiciones (recordatorio operativo)

Permitido en M4-C: contratos de adaptadores, registro de capacidades, sandbox local, adaptadores fake/grabados, evidencia reproducible, smoke opt-in, health checks, errores normalizados, timeouts y cancelación. **Prohibido:** secretos productivos, cuentas reales, llamadas reales en `verify`, proveedores por defecto, publicar, enviar mensajes, gastar dinero, `AUTONOMOUS_REAL`. Los adaptadores reales nacen `DESACTIVADO · SIMULADO · SIN_CREDENCIAL · NO_CONSUMIBLE` y sólo avanzan por actos humanos auditados.

## M4-C-A-H — Sandbox como autoridad (hardening)

La auditoría de M4-C-A dictaminó `REQUIERE_CORRECCIONES`: el sandbox **envolvía** al adaptador pero no **gobernaba** su salida ni el tenant. M4-C-A-H convierte al sandbox en la **única autoridad**:

- **Salida no autoritativa (C-1):** el puerto `AdaptadorExterno.ejecutar` devuelve `SalidaAdaptador` (`estado`/`salida`/`error`/`uso`) — **sin** modo, identidad, versión, instante ni tenant. El `ResultadoAdaptador` autoritativo (con `organizationId`/`requestId`/`solicitudId`/`capacidadId`/`adaptador`/`version`/`modoSolicitado`/`modoEjecutado`/`naturaleza`/`observadoEn`) lo construye **siempre** el sandbox desde datos confiables. Cualquier campo que un adaptador cuele por runtime se ignora; una salida estructuralmente incoherente → `INVALIDO`.
- **Contexto organizacional obligatorio (C-2):** la autoridad de tenant/capacidad viene de `RequestContext` + `CapacidadState`, nunca del payload, la salida, la grabación ni la `secretRef`. El sandbox valida que el `CapacidadState` corresponda al `organizationId` y al `capacidadId` de la solicitud. La evidencia lleva `organizationId`/`capacidadId`/`solicitudId`/`requestId`. Las grabaciones se indexan por clave **scoped** (`org::capacidad::version::operación(params)`): una grabación de la Org A no puede ser encontrada por la Org B.
- **Consumibilidad calculada dentro del sandbox (C-4):** el sandbox invoca **`esConsumible`** (autoridad única M4-A) sobre el `CapacidadState`; no acepta un veredicto libre del llamador. La degradación se traduce a una **directiva explícita** (`RECHAZADO_ABSTENCION`/`EJECUTAR_SIMULADO`/`DETENIDO`/`REQUIERE_RESOLUCION_DE_ALTERNATIVA`/`REQUIERE_RESOLUCION_DE_CACHE`); sólo `SIMULAR` continúa (en `SIMULADO` explícito). Alternativa y caché se **declaran** pero no se ejecutan en M4-C-A-H (pertenecen a M4-C-B/M4-D).
- **Cancelación autoritativa y respuestas tardías (C-3):** si la señal está abortada **antes**, no se invoca al adaptador. Tras la espera se **revalida** la señal: una respuesta que llega tras la cancelación se **descarta**. Un resultado, una vez decidido, es cerrado.
- **Timeout wall-clock opt-in (C-7):** `carreraConTimeout` es infraestructura **opt-in deshabilitada por defecto**, separada del núcleo determinista (único lugar con timer). Precedencia documentada: señal ya abortada → `CANCELADO`; abort durante la espera → `CANCELADO`; timeout antes de la respuesta → `TIMEOUT`; respuesta antes → validar. Resolución tardía descartada; sin retry automático.
- **Inmutabilidad (C-5):** la entrada al adaptador va **clonada y congelada** (no puede mutar la solicitud del sandbox) y el resultado/evidencia se devuelven **congelados** (el consumidor no puede mutarlos). El clon rechaza tipos no serializables/mutables y referencias circulares.
- **`secretRef` canónica (C-6):** el gate REAL valida la `secretRef` con la **barrera canónica** `esReferenciaSecreto` (M4-A/M4-B) — no una regex duplicada; nunca resuelve el valor.
- **Fake/Grabado no son autoridad:** implementan el mismo contrato, respetan tenant/capacidad/solicitud y producen sólo `SalidaAdaptador`; **no** construyen evidencia final ni deciden modo/naturaleza. El sandbox es la única SSOT de la evidencia.

## Tramos

- **M4-C-A** (contratos) + **M4-C-A-H** (sandbox autoritativo): completados.
- **M4-C-B** (siguiente, a ratificar): registro/gobernanza de adaptadores event-sourced ligado a la capacidad; revocación/expiración/eliminación (F-4 de ADR-0022); primer adaptador real DESACTIVADO con revisión y tests específicos de no-filtración; cableado del timer real de `carreraConTimeout` en un runner de frontera (nunca en `verify`).
