# ADR-0021 — Núcleo de la PCE: capacidad externa gobernada (M4-A)

- **Estado:** Aceptado.
- **Fecha:** 2026-08-01.
- **Gobernado por:** Directiva Maestra PCE (`docs/governance/DIRECTIVA-MAESTRA-PCE.md`), Título I. Adopción: ADR-0020.

## Contexto

M4-A construye el **núcleo** de la Plataforma de Capacidades Externas: el registro y el ciclo de vida gobernado de una **capacidad externa**, sin ningún proveedor real todavía (los adaptadores llegan en M4-C). Debe implementar el Título I sin romper las invariantes de SOEC (event-sourcing, multi-tenant, determinismo, neutralidad).

## Decisión

Paquete nuevo **`@soec/plataforma-capacidades`** (event-sourced, multi-tenant, determinista, **neutral** — sin SDKs/red/reloj, verificado por test de arquitectura). Nombre elegido para no colisionar con el `@soec/capacidades` existente (capacidad cognitiva "Comprender el estado").

Agregado **CapacidadExterna** (`capacidad-externa:<org>:<capacidadId>`) + índice por organización (`capacidades-externas:<org>`, idempotente/autorreparable). Aplica:

- **Art. 2/4 — dominio conoce Capacidades, no Proveedores (ni costo, ni secretos):** el estado sólo guarda `proveedorRef` y `secretRef` (referencias opacas). No existe campo de costo ni de proveedor concreto ni de valor de secreto. `configurar` **rechaza** un `secretRef` que no sea una referencia (`esquema:…`), impidiendo un secreto en claro.
- **Art. 3 — Capacidad ≠ Activación:** máquina de estados `REGISTRADA→CONFIGURADA→HABILITADA→AUTORIZADA→EN_USO` + transversales `PAUSADA/DESHABILITADA/REEMPLAZADA/ELIMINADA`; `AUTORIZADA`/`EN_USO` exigen **actor humano**; nace `SIMULADA`; `activarReal` exige EN_USO + refs + salud SALUDABLE y nunca es implícito.
- **Art. 7 — todo cambio versiona:** `configVersion` incrementa en cada `configurar`.
- **Art. 8 — kill-switch:** `pausar`/`deshabilitar`/`volverASimulado` devuelven la capacidad a `SIMULADA` de inmediato.
- **Art. 11 — degradación obligatoria:** `politicaDegradacion` (ABSTENER/SIMULAR/ALTERNATIVA/CACHE/DETENER) es obligatoria y explícita al registrar/configurar.
- **Art. 13 — salud (observable ≠ confiable):** `SALUDABLE/DEGRADADA/NO_CONFIABLE`; registrar `NO_CONFIABLE` estando en modo REAL vuelve a `SIMULADA` (fail-safe).

## Consecuencias

- (+) Base neutral sobre la que M4-B (secretos por referencia), M4-C (adaptadores reales) y M4-D (motor supervisado) se apoyan sin tocar el dominio.
- (+) Las invariantes constitucionales quedan codificadas y verificadas por tests (ciclo de vida, kill-switch, fail-safe, referencias, versión, multi-tenant, neutralidad).
- (−) Aún no hay consumo real (ningún adaptador ni motor lo usa todavía): `INTEGRADO_SOLO_EN_NUCLEO` hasta M4-C/M4-D.

## Correcciones post-auditoría de M4-A

Tras la auditoría local del núcleo se aplicaron:

- **M4A-1 (ALTO) — referencia opaca real (Art. 4):** `secretRef` debe ser una referencia de una allowlist de esquemas (`env/vault/aws-sm/gcp-sm/azure-kv/file/ref`) **y** no puede tener forma de secreto (`sk-…`, `AKIA…`, `Bearer …`, valores con `=`, espacios o tokens largos de alta entropía). `proveedorRef` se valida como identificador lógico acotado. Un secreto camuflado como referencia queda rechazado (`domain/referencias.ts`).
- **M4A-2 (MEDIO) — autoridad única de consumibilidad:** `esConsumible(state)` es la única fuente que responde "¿puede consumirse ahora?" (EN_USO + salud ≠ NO_CONFIABLE); devuelve la política de degradación cuando no. Todo consumidor (M4-C/D) debe usarla en vez de re-derivar.
- **M4A-3 (MEDIO) — versionado idempotente (Art. 7):** reconfigurar con contenido idéntico no incrementa `configVersion`.
- **M4A-4 (MEDIO) — target de degradación (Art. 11):** `ALTERNATIVA` exige `alternativaCapacidadId` (≠ la propia capacidad); `CACHE` exige `cacheRef`. **Deuda documentada (no bloqueante):** la existencia/compatibilidad del target de la ALTERNATIVA se valida en el **punto de consumo (M4-D)**, no al configurar (la alternativa puede configurarse después).
- **M4A-5 (MEDIO) — reemplazo gobernado:** `reemplazar(ctx, id, porId, actorHumano)` valida acto humano + existencia + misma organización + mismo tipo (compatibilidad) + no self + no reciprocidad directa. `transicionar(REEMPLAZADA)` queda bloqueado (forza el camino gobernado).

**Deuda declarada NO bloqueante** (a abordar cuando haya consumo real): **M4A-6** kill-switch sólo por-capacidad (no org-wide/global) — alcance documentado aquí; **M4A-7** test de arquitectura por substring (guardarraíl, evadible por strings construidos); **M4A-8** faltan tests de concurrencia optimista, reparación del índice ante fallo y replay explícito.

## Fuera de alcance (tramos siguientes)

Secret store real (M4-B), adaptadores de proveedor real detrás del puerto (M4-C), costeo/selección/fallback y motor supervisado (M4-D), observabilidad (M4-E). Sin publicación/gasto/envío; `AUTONOMOUS_REAL` bloqueado.
