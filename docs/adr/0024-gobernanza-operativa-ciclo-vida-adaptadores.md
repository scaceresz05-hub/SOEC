# ADR-0024 — Gobernanza operativa del ciclo de vida de adaptadores (M4-C-B)

- **Estado:** Aceptado (tramo M4-C-B; en curso).
- **Fecha:** 2026-08-02.
- **Gobernado por:** Directiva Maestra PCE (Título I). Se apoya en M4-A (capacidades, ADR-0021), M4-B (SecretStore por referencia, ADR-0022) y M4-C-A/H (sandbox autoritativo, ADR-0023).

## Contexto

M4-C-A-H dejó un sandbox que **gobierna una ejecución**. Falta la capa que **administra un adaptador durante todo su ciclo de vida**: registrarlo, configurarlo, habilitarlo, autorizarlo (acto humano), observarlo, degradarlo, revocarlo, expirarlo y retirarlo — todo **antes** de que cualquier adaptador real pueda ejecutar. M4-C-B construye esa gobernanza **sin** conectar proveedores: ningún SDK, red, credencial o llamada real; el primer adaptador concreto es una **carcasa neutral desactivada**.

## Decisión

### SSOT y relación `CapacidadExterna ↔ RegistroAdaptador`

- **`CapacidadState` (M4-A)** es la SSOT de la *capacidad* (qué se puede hacer, su ciclo, salud, degradación, `esConsumible`).
- **`RegistroAdaptador` (M4-C-B)** es la SSOT del *adaptador operativo* (qué implementación sirve una capacidad, su estado operativo, versión de contrato/implementación, salud operativa, circuit breaker, límites, revocación/expiración). **No duplica** la máquina de estados de la capacidad.
- La **consumibilidad final** de una ejecución REAL depende CONJUNTAMENTE de: `CapacidadState` (`esConsumible`, M4-A) **+** `RegistroAdaptador` (estado operativo) **+** estado de frontera (M4-C-A) **+** `secretRef` válida (M4-B) **+** salud **+** política económica **+** sandbox autoritativo (M4-C-A-H). Ninguno alcanza por sí solo.

### Estado operativo del adaptador (propio, no el de la capacidad)

`REGISTRADO → CONFIGURADO → HABILITADO → AUTORIZADO`, más transversales `PAUSADO/REVOCADO/EXPIRADO/REEMPLAZADO/ELIMINADO`. Reglas: `AUTORIZADO` exige actor humano; `HABILITADO ≠ autorización`; `PAUSADO/REVOCADO/EXPIRADO/REEMPLAZADO/ELIMINADO` no ejecutan; `REVOCADO` no vuelve sin nueva autorización/versionado; `REEMPLAZADO` es terminal para consumo; `ELIMINADO` es baja lógica que preserva historial; **nunca** nace `AUTORIZADO` ni `REAL`; `REAL` no se activa automáticamente.

### Revocación / expiración / eliminación lógica (cierra F-4 de ADR-0022)

- **Revocación:** invalida ejecución futura, conserva historial, registra actor+motivo+fecha, impide resolución operativa de la credencial. No borra la referencia histórica.
- **Expiración:** `expiraEn` gobierna la ejecución (no es metadata decorativa); una capacidad expirada no ejecuta.
- **Eliminación lógica:** preserva eventos, impide uso y reactivación silenciosa, permite auditoría. **No** hay borrado físico de secretos (no existen secretos reales en este bloque): se modela sólo el contrato + evento gobernado.

### Compatibilidad, salud, circuit breaker, retry, concurrencia

- **Compatibilidad de versiones** (`CompatibilidadAdaptador`): contrato/adaptador/evidencia/capacidad deben coincidir; si no → `INCOMPATIBLE`, no ejecuta ni degrada en silencio. Cambios de versión event-sourced.
- **Health checks operativos**: puerto neutral; en M4-C-B sólo implementaciones sintéticas/grabadas/deterministas sin red. Salud afecta la ejecución (`SALUDABLE` sigue; `DEGRADADA` política explícita; `NO_CONFIABLE` bloquea; `DESCONOCIDA` fail-safe, no REAL).
- **Circuit breaker** determinista (`CERRADO/ABIERTO/SEMIABIERTO`) con **reloj inyectado** (no `Date.now`); replay reproduce el estado.
- **Retry/backoff** gobernado, **deshabilitado por defecto**, `jitter=false` (determinismo); nunca reintenta `INVALIDO/NO_AUTORIZADO/CANCELADO` ni tras revocación/expiración.
- **Límite de concurrencia** (en memoria, no distribuido) con liberación garantizada ante éxito/error/cancelación/timeout y aislamiento por organización.

### Observabilidad y composición

Evidencia/eventos operativos permiten responder qué adaptador/capacidad/organización/versión/contrato/estado/salud/intento/duración/error/breaker/retry/límite/actor. **No** registran secreto, `secretRef` innecesaria, payload sensible, mensaje original del proveedor, `stack` ni `cause`. La `duración` se declara `REAL/ESTIMADA/SIMULADA`. El orquestador compone: registro → estado → expiración/revocación → compatibilidad → salud → breaker → concurrencia → retry → **sandbox autoritativo** → evidencia operativa, sin duplicar `esConsumible`/`esReferenciaSecreto`/sandbox.

### Primer adaptador concreto (carcasa)

Un paquete-frontera neutral (`@soec/adaptador-generativo-externo`) con un adaptador que **nace desactivado**, implementa `AdaptadorExterno`, declara contrato/versión y capacidades honestamente, trae health check y smoke **sintéticos**, y **no puede ejecutar REAL**. No importa SDK, no llama red, no lee `process.env`, no resuelve secretos, no nombra un proveedor comercial en el dominio.

## Consecuencias

- (+) Todo adaptador queda gobernado (estado, compatibilidad, salud, breaker, límites, revocación/expiración) **antes** de poder ejecutar; el sandbox sigue siendo la autoridad de la ejecución.
- (+) Cierra F-4 de ADR-0022 (revocación/expiración/eliminación) a nivel de contrato y evento.
- (−) Sin proveedor real, red, SDK ni secretos: el adaptador concreto es una carcasa; el smoke real queda como contrato bloqueado. Circuit breaker/semáforo son en memoria (no distribuidos): deuda explícita para M4-C-C/M4-D.

## Deuda permitida (M4-C-C/M4-D)

Circuit breaker y semáforo distribuidos, métricas productivas, proveedor/SDK concreto, secret store productivo, smoke real, costeo real por proveedor, fallback real entre adaptadores. **No** son deuda: revocación, expiración, eliminación lógica, aislamiento, compatibilidad, health fail-safe, circuit breaker básico, retry gobernado, concurrencia básica, sandbox autoritativo.
