# DIRECTIVA MAESTRA — MACROBLOQUE 4-D
## Primera Integración Externa Real Supervisada

> **ESTADO: RATIFICADA (v1.0) como MARCO DE GOBERNANZA** (Dirección Técnica, 2026-08-04). Adoptada como marco obligatorio de la integración real. **Ratificar el marco NO habilita el modo REAL:** ningún adaptador real, SDK, credencial, red, dato real o gasto puede introducirse hasta que, además, se ratifiquen las decisiones irreversibles pendientes (§13, D-1..D-7) y se apruebe expresamente el primer piloto. Hasta entonces la integración permanece en **preparación cerrada / simulada** y `AUTONOMOUS_REAL` sigue bloqueado. **La ratificación del marco no resuelve ninguna decisión estratégica (D-1..D-7): siguen explícitamente pendientes.**

- **Versión:** 1.0 (ratificada). Cambios v0.1→v0.2 en el changelog; v0.2→v1.0 = ratificación del marco, sin cambios normativos (D-1..D-7 siguen pendientes).
- **Rama:** `feat/macrobloque-4d` (nace de `main` = `ae30427`, cierre de la Fundación M4).
- **Relación con M4:** M4-D se apoya en la **Fundación M4** (tag `fundacion-m4`) sin reabrirla. La Fundación provee la arquitectura neutral y gobernada; M4-D **sólo** añade adaptadores reales sometidos a esa arquitectura. Ninguna integración real es una excepción a las garantías ya consolidadas.
- **Gobernado por:** Directiva Maestra PCE v2.1 (Título I permanente). M4-D **no** modifica la PCE; la aplica.

---

## Principio rector

> **Un proveedor real es un detalle de implementación tras la frontera; jamás una autoridad.** La decisión de ejecutar —con qué modo, con qué datos, con qué costo— la toma la gobernanza de SOEC (registro + descriptor + capacidad + sandbox), no el SDK ni el proveedor. M4-D conecta código de terceros **sin** cederle ninguna decisión que la Fundación M4 ya gobierna.

Corolarios heredados (no renegociables):
- El dominio conoce **Capacidades, no Proveedores** (PCE Art. 2).
- **Capacidad ≠ Activación**; **Intención ≠ Autorización** (F-CB-1).
- Secretos **sólo por referencia**; el dominio nunca lee un valor (PCE Art. 4).
- **`AUTONOMOUS_REAL` bloqueado** salvo decisión humana explícita, versionada y auditada.
- **Salud fail-closed, determinismo, evidencia reproducible, multi-tenant** (Fundación M4).

---

## §0 — Escala de estados independientes (ninguno implica el siguiente)

M4-D distingue con precisión **cinco estados que NO se implican entre sí**; cada avance es un acto humano auditado y versionado, y ninguno autoriza al siguiente:

| Estado | Significa | NO significa |
|---|---|---|
| **Proveedor seleccionado** | existe un ADR que elige un proveedor para una capacidad (D-1) | que haya adaptador instalado |
| **Adaptador instalado** | el paquete-frontera del proveedor existe en el repo (aún sin credencial) | que tenga credencial ni capacidad autorizada |
| **Credencial configurada** | hay una `secretRef` válida asociada por acto humano | que la capacidad esté autorizada ni habilitada |
| **Capacidad autorizada** | el `RegistroAdaptador` está `AUTORIZADO` + descriptor `soportaReal=true` | que la ejecución esté habilitada (modo/estado siguen gobernando) |
| **Ejecución habilitada** | modo REAL habilitado por acto humano, con todos los gates verdes | ejecución autónoma (`AUTONOMOUS_REAL` sigue bloqueado) |

Confundir dos de estos estados es un error de gobernanza. La evidencia debe permitir distinguirlos.

## Eje 1 — Proveedores candidatos y criterios objetivos de selección

- El dominio **nunca** nombra un proveedor comercial; cada proveedor real vive en un **paquete-frontera propio** (`@soec/adaptador-<capacidad>-<id-logico>`), detrás del puerto `AdaptadorExterno` y su `DescriptorAdaptador`.
- La selección se documenta en un **ADR por proveedor**, evaluado contra una **rúbrica objetiva** (a ratificar): idoneidad técnica para la capacidad lógica; **residencia y tratamiento de datos** (ver Eje 3 y D-6); **política de retención/entrenamiento/subprocesadores** del proveedor; disponibilidad/SLA; previsibilidad de costos; soporte de cancelación/timeout; madurez del SDK; requisitos de credencial; mecanismo de eliminación/auditoría.
- **DECISIÓN IRREVERSIBLE PENDIENTE (D-1):** proveedor(es) concreto(s) y capacidad inicial. **No se decide en este borrador.**

## Eje 2 — Datos que **pueden** salir del dominio (lista blanca cerrada y tipada)

- Lo que cruza la frontera hacia un proveedor real es una **lista blanca CERRADA y TIPADA por capacidad**, declarada como un **contrato/esquema** (`EsquemaDatosSalientes`), no una autorización genérica a enviar "el contexto necesario".
- **Default-deny estricto:** todo campo no declarado explícitamente en el esquema **no sale**. El sandbox/orquestador son la autoridad de qué se envía; el adaptador **no puede ampliar** el esquema (extensión de F-CBH-1 al plano de datos, verificada por tests — Eje 6).
- La `SolicitudAdaptador` que llega al adaptador real es la **mínima** necesaria; los campos se **tipan** y se validan antes de salir.
- **DECISIÓN IRREVERSIBLE PENDIENTE (D-2):** el esquema concreto de campos permitidos **por capacidad**. Se ratifica por capacidad, no globalmente.

## Eje 3 — Datos que **nunca** pueden salir del dominio (prohibición dura)

Prohibición dura, default-deny, verificada por tests (no por convención). **Nunca** salen:
- secretos, valores de credencial, **tokens**, claves;
- **información clínica/sanitaria identificable** y cualquier dato sensible de salud;
- datos personales identificables de socios/usuarios más allá del mínimo tipado y ratificado (D-2);
- **documentos completos** (PDFs/adjuntos/archivos íntegros): sólo puede salir el campo tipado mínimo, nunca el documento entero;
- **datos de otro tenant** (aislamiento estricto multi-tenant);
- identificadores internos que permitan correlación cross-tenant;
- cualquier dato regulado (Ley 20.998 y afines) sin base legal explícita;
- `secretRef` completa innecesaria; payloads sensibles; mensajes de error crudos del proveedor.

## Eje 4 — Costos, cuotas, presupuestos y **topes duros** (antes de la llamada)

- Cada capacidad real declara **presupuesto** y **cuotas** (por organización, capacidad y ventana temporal) con **topes duros**.
- **El control de presupuesto opera ANTES de la llamada:** se estima el costo del request y, si superaría el tope, se **rechaza gobernadamente** sin llamar al proveedor. Nunca se llama primero y se controla después.
- **Estimación conservadora ante costo desconocido:** si el costo exacto no puede conocerse de antemano, se usa una **cota superior conservadora**; ante duda, se rechaza (fail-safe hacia no-gasto), no se ejecuta.
- El **costo pertenece a la frontera**, no al dominio (PCE Art. 2): el dominio decide *si* ejecutar según la política de presupuesto, sin conocer el precio unitario comercial. La estimación/consumo se registran como **evidencia** con naturaleza declarada (`REAL/ESTIMADA/SIMULADA`); nunca el precio comercial concreto dentro del dominio.
- **DECISIÓN IRREVERSIBLE PENDIENTE (D-3):** montos de presupuesto/topes y su SSOT (¿config gobernada? ¿evento?). **No se fija en este borrador.**

## Eje 5 — SecretStore productivo

- M4-D introduce el **primer adaptador de `SecretStore` real** detrás del puerto de M4-B, en su **propia frontera**. El dominio sigue conociendo sólo `secretRef`; el valor se resuelve **exclusivamente** dentro del adaptador y sólo dentro de `usar(fn)` (contrato "Ámbito sensible" de ADR-0022).
- Requisitos del adaptador productivo: campo privado real para todo valor (estándar M4-BH); redacción total en logs/serialización; sin exponer mapas internos; **revisión y tests específicos de no-filtración** antes de habilitarse; **rotación/expiración/revocación** gobernadas.
- **DECISIÓN IRREVERSIBLE PENDIENTE (D-4):** backend de secretos productivo y su gobernanza (rotación, acceso, auditoría). **No se decide aquí.**

## Eje 6 — Pruebas de **no-filtración** por adaptador (obligatorias, permanentes)

Ningún adaptador real se habilita sin una batería **permanente** (en el repo, no probes temporales) que demuestre con sentinelas sintéticos que:
- el valor de un secreto nunca aparece en resultado, evidencia, logs, errores ni red observable;
- **sólo** salen los campos del esquema tipado (Eje 2); todo lo no declarado no sale (incl. documentos completos, datos clínicos, otros tenants);
- los errores del proveedor se **normalizan** sin arrastrar mensaje original/stack/cause;
- se respetan cancelación/timeout y no se publican respuestas tardías (heredado M4-C-A-H).

Estas pruebas corren en `verify` **contra fakes/grabaciones**, nunca contra el proveedor real.

## Eje 7 — Activación progresiva: `SIMULADO → SANDBOX → PILOTO → REAL`

`PILOTO` y `REAL` **no son sinónimos**. Cada avance es un acto humano auditado:

| Estado | Permite | Red real | Datos reales | Gate para avanzar |
|---|---|---|---|---|
| **SIMULADO** | fake/grabado determinista | No | No | tests + descriptor `soportaReal=false` |
| **SANDBOX** | SDK real contra endpoint de pruebas, datos sintéticos | Sí (sandbox) | No | no-filtración + **cierre de F-CCC-1** + revisión humana |
| **PILOTO** | tráfico real acotado y **time-boxed** | Sí | Sí (mínimos) | **organización + volumen + período + personas autorizadas (nominadas) + kill-switch probado + base legal/consentimiento + presupuesto/topes** |
| **REAL** | operación gobernada general | Sí | Sí | criterios de aptitud (Eje 9) + ratificación humana |
| **AUTONOMOUS_REAL** | ejecución autónoma sin acto | — | — | **BLOQUEADO** (no se levanta en M4-D) |

El salto **nunca** es automático ni por configuración sola. El **PILOTO** debe definir explícitamente: **qué organización, qué volumen, qué período, qué personas autorizadas, qué datos y con qué kill-switch**.
- **DECISIÓN IRREVERSIBLE PENDIENTE (D-5):** alcance concreto del PILOTO (organización, volumen, período, personas, datos, consentimiento). **No se decide aquí.**

## Eje 8 — Rollback, revocación y kill-switch (honestidad sobre lo irreversible)

- **Kill-switch** por capacidad/adaptador/organización que **devuelve inmediatamente a SIMULADO** (PCE Art. 8), verificable y probado antes de cualquier PILOTO.
- **Revocación/expiración/eliminación lógica** (M4-C-B) aplican a adaptadores reales: revocar **bloquea ejecución futura** e **impide resolución operativa de la credencial**.
- **Límite honesto:** el rollback **no puede deshacer una divulgación ya realizada a un tercero** — una vez que un dato salió, salió. Por eso el rollback significa **detener, revocar, ROTAR el secreto comprometido, bloquear y gestionar la retención** (solicitar eliminación al proveedor según D-6), no "revertir el envío". La prevención (Ejes 2/3/4) es la única defensa real ante la divulgación; el rollback gestiona las consecuencias.
- **Rollback de versión** de adaptador/descriptor event-sourced; un adaptador REAL problemático se retira a SANDBOX/SIMULADO sin perder historial.
- Regla: ante duda, **fail-safe hacia SIMULADO/bloqueo/no-gasto**, nunca hacia ejecución real.

## Eje 9 — Criterios de aptitud para producción

Un adaptador sólo puede declararse **apto para REAL** con evidencia de: descriptor con `soportaReal=true` habilitado por acto humano e **instancia sellada (F-CCC-1 cerrado)**; tests de no-filtración permanentes verdes; sin filtración fuera del esquema tipado; salud fail-closed, circuit breaker, retry gobernado, concurrencia y **presupuesto/topes** activos; kill-switch y rollback probados; revocación/expiración verificadas; cancelación/timeout con proveedor real validados en SANDBOX; PILOTO superado dentro de umbral; ADR de proveedor ratificado y revisión humana registrada.

## Eje 10 — Cierre de F-CCC-1 y regla permanente de `verify`

- **F-CCC-1 (pre-requisito duro y VERIFICABLE de todo adaptador real):** antes de conectar cualquier SDK, la composición debe **sellar/capturar** los métodos e identidad de la instancia ejecutora (o exigir una instancia registrada/congelada), de modo que un monkey-patch posterior no altere el comportamiento autorizado. Se cierra con **código + tests adversariales** (no una declaración documental). Ningún adaptador avanza a SANDBOX sin esto cerrado.
- **Regla permanente e innegociable:** **`verify` NUNCA realiza llamadas reales.** El smoke real requiere **doble condición**: (1) **activación humana explícita** y (2) **configuración fuera de `verify`**. Una variable de entorno aislada **no basta**. Ninguna combinación automática lo activa. El `verify` de M4-D sigue corriendo contra fakes/grabaciones.
- **F-CCC-2:** la huella FNV-1a es versionado/detección, no firma criptográfica; si M4-D requiere integridad fuerte del descriptor, se decide un hash criptográfico en su propio ADR.

---

## §13 — Decisiones irreversibles pendientes (requieren ratificación humana antes de implementar)

| ID | Decisión | Eje | Estado |
|----|----------|-----|--------|
| **D-1** | Proveedor(es) concreto(s) y capacidad inicial | 1 | PENDIENTE |
| **D-2** | Esquema tipado de datos salientes por capacidad | 2 | PENDIENTE |
| **D-3** | Montos de presupuesto/topes y su SSOT | 4 | PENDIENTE |
| **D-4** | Backend de SecretStore productivo y su gobernanza | 5 | PENDIENTE |
| **D-5** | Alcance del PILOTO (org, volumen, período, personas, datos, consentimiento) | 7 | PENDIENTE |
| **D-6** | **Política contractual y de tratamiento de datos del proveedor:** retención, entrenamiento, subprocesadores, región/residencia, eliminación y auditoría | 1/3/5/8 | PENDIENTE |
| **D-7** | **Estrategia de residencia y minimización:** qué datos se transforman, anonimizan o seudonimizan antes de abandonar SOEC, y cuáles nunca salen sin transformar | 2/3 | PENDIENTE |

Ninguna se toma en este borrador. Cada una se ratifica por separado, con su propio ADR, antes de habilitar el estado que la requiere. **D-6 y D-7 no son detalles legales secundarios:** determinan técnicamente el adaptador, la evidencia que se conserva y qué información puede enviarse.

## §14 — Alcance prohibido mientras esta directiva no esté ratificada

```text
Instalar SDKs de proveedor.        Enviar datos reales fuera del dominio.
Conectar cuentas/endpoints reales. Gastar dinero.
Ingresar/solicitar credenciales.   Levantar AUTONOMOUS_REAL.
Realizar llamadas de red reales.   Escribir código funcional de adaptadores reales.
Ejecutar smoke real (bloqueado).   Resolver D-1..D-7 por cuenta propia.
```

## §15 — Gobernanza del cambio

Igual que la PCE: se enmienda **sólo** por la Dirección Técnica, con nueva versión, changelog y ADR. La ratificación de la v1.0 corresponde a la Dirección Técnica humana.

## §16 — Trazabilidad de los criterios de revisión (para facilitar la ratificación)

| Criterio de revisión | Sección que lo satisface |
|---|---|
| Datos salientes: lista cerrada, tipada, por capacidad (no "contexto necesario") | Eje 2 + D-2 |
| Prohibidos: clínico identificable, credenciales, secretos, tokens, documentos completos, otros tenants | Eje 3 |
| Proveedor no usa datos para entrenamiento/retención/fines propios sin decisión expresa | Eje 1 + D-6 |
| Topes económicos antes de la llamada + estimación conservadora si el costo es desconocido | Eje 4 |
| PILOTO ≠ REAL: org, volumen, período, personas autorizadas, kill-switch | Eje 7 + D-5 |
| Rollback no promete deshacer una divulgación ya hecha; detiene/revoca/rota/bloquea/gestiona retención | Eje 8 |
| F-CCC-1 como criterio técnico verificable | Ejes 9/10 |
| Smoke real: doble condición (activación humana + fuera de `verify`); una env var no basta | Eje 10 |
| Distinción proveedor seleccionado / adaptador instalado / credencial configurada / capacidad autorizada / ejecución habilitada | §0 |
| D-1..D-5 sin resolver; sin proveedor/presupuesto/backend/piloto por defecto | §13 |
| D-6 (contrato/tratamiento de datos) | §13 |
| D-7 (residencia y minimización) | §13 |

---

### Changelog
- **0.1 (borrador):** primera redacción, 10 ejes + §13 (D-1..D-5).
- **0.2 (borrador):** §0 escala de estados independientes; Eje 2 lista blanca cerrada/tipada por capacidad; Eje 3 prohibidos explícitos (clínico/tokens/documentos completos/otros tenants); Eje 4 tope **antes de la llamada** + estimación conservadora; Eje 7 PILOTO con período + personas autorizadas; Eje 8 límite honesto (rollback no deshace divulgación) + rotación; Eje 10 smoke real doble condición + F-CCC-1 verificable; **añadidas D-6 y D-7**; §16 trazabilidad de criterios. **Sigue sin resolver ninguna decisión estratégica.**
