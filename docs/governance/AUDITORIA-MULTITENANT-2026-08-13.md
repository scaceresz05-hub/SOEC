# Auditoría multitenant de SOEC — previa a la segunda organización real

**Fecha:** 2026-08-13 · **Rama:** `main` · **HEAD:** `cf1c6e7` · **Árbol:** limpio
**Motivo:** incorporación de **Distribuidora C Y P SpA** como SEGUNDA organización real, independiente de SmileFlow Clinic.
**Alcance de este documento:** FASE 0 (gobernanza/baseline), FASE 1 (auditoría) y FASE 2 (matriz). **No** incorpora C Y P, **no** corrige la deuda hallada, **no** ejecuta acción externa alguna.

> Principio establecido por este bloque: **SOEC es una plataforma multiempresa. Ninguna organización puede acceder, usar, contaminar, modificar ni aprender implícitamente de datos de otra.** SmileFlow deja de ser el centro conceptual: pasa a ser *una* organización dentro de la plataforma.

---

## 0. Baseline de gobernanza (verificado, no declarado)

| Verificación | Estado observado |
|---|---|
| Repositorio / rama / HEAD | `C:\proyectos\SOEC` · `main` · `cf1c6e7` · `git status` limpio (0 cambios) |
| Repositorio SmileFlow | `C:\proyectos\smileflow-clinic` — **no tocado** |
| Scheduler Windows | `SOEC-Ingesta-Observacion` (Ready, cada ~15 min) · `SOEC-Runtime` (Running) |
| Última ingesta | `GLOBAL_OK` · 272 eventos ingeridos · 0 fallos |
| Veredicto del Director (real) | `OBSERVAR` |
| Plan de acción G1 | `DRY_RUN`, 0 propuestas |
| G2-A | Cadena write gobernada presente, en **DRY-RUN**; 0 intenciones creadas |
| G2-B | **NO INICIADO** — no existe ninguna ruta de código que envíe `googleAds:mutate` |
| `AUTONOMOUS_REAL` | **`false`** — constante de compilación (`false as const` en `@soec/cia/dominio/guardarrailes.ts`); no configurable por entorno |
| `REAL_GOOGLE_ADS_MUTATE_CALLS` | **0** — `GoogleAdsWriteAdapter.ejecutarReal()` llama `assertSimulado('REAL')` y lanza antes de cualquier HTTP; el envío no está implementado |
| Google Ads | **READ ONLY** (Reader usa sólo `googleAds:searchStream`; prueba de arquitectura lo verifica) |
| `pnpm -r typecheck` | **PASS** (48 workspaces, 0 fallos) |
| `vitest run` | **PASS** (235 archivos · 1564 pruebas · 1 omitida) |

**Hallazgo colateral (no multitenant, preexistente):** `packages/models/test/pg/models.pg.test.ts > proyecciones: worker drena el outbox` falla de forma **intermitente** cuando la corrida coincide con un tick de la tarea `SOEC-Ingesta-Observacion`, que escribe en las mismas tablas `events`/`outbox` de la base compartida. Reproducido y confirmado: la prueba pasa 7/7 al ejecutarse aislada. No lo causa este bloque; se registra como fragilidad de aislamiento entre la suite y el scheduler vivo.

**Datos reales en base:** `events` contiene 659 eventos de `org-smileflow` y 1 de `orgA` (residuo de prueba). **No existe todavía ninguna organización C Y P.**

---

## 1. Lo que SÍ está probado como multitenant (fortalezas reales)

Estas capas resisten un segundo tenant **hoy**, con evidencia:

1. **Persistencia (event store).** `PgEventStore` filtra `organization_id = $ctx.organizationId` en *toda* consulta (`readStream`, `currentVersion`, `reconstructAt`, idempotencia y `append`). `InMemoryEventStore` particiona por `${org}::${streamId}`.
2. **Read models.** Las **22** tablas `proj_*` tienen `organization_id` como **primera columna de su PRIMARY KEY**. Dos organizaciones con el mismo identificador de recurso ocupan filas distintas; no hay sobrescritura cruzada posible.
3. **Contrato de alcance.** `requireScope` lanza `ScopeMismatchError` si `scope.organizationId !== ctx.organizationId`, y `ScopeRequiredError` si falta permiso. **Rechazo por defecto**, sin lectura degradada.
4. **Autenticación / autoridad de tenant.** La organización se deriva de la **sesión + membresía activa**, nunca del `:org` de la URL. El gateway (`vertical-gateway.ts`) **sobrescribe** las cabeceras `x-organization-id/-actor-id/-scope` con valores autoritativos server-side; lo que envíe el cliente se descarta.
5. **Identidad de organización.** `@soec/identity` modela `Organization` con `slug` = clave de tenant (== `organizationId` de los streams), `Membership`, `Invitation` y `AuditEvent` con `organization_id`. Ya existe `POST /organizations` y una UI de selección.
6. **Credenciales por referencia.** `@soec/secretos` registra `nombreLogico → secretRef` en el stream **por organización** (`secreto:<org>:<nombre>`); nunca guarda el valor. El valor se resuelve sólo en el adaptador de frontera dentro de una caja opaca.
7. **Aprendizaje/memoria.** `@soec/aprendizaje` prohíbe estructuralmente que un aprendizaje nacido en una organización se aplique a otra sin `AplicacionAprendizaje { organizacionDestino, actorHumano, decisionId, justificacion }`. **Nunca se transfiere solo.**
8. **Adaptadores externos.** `@soec/adaptadores` ya tiene pruebas multi-tenant: la grabación de la Org A no es reutilizable por la Org B (clave de grabación scoped).
9. **Confinamiento de tenant en la cadena write.** Tanto `gates.ts` como `executor-governado.ts` incluyen una puerta `CONFINAMIENTO_TENANT` que rechaza toda intención cuyo `org`/`customerId` no sean los autorizados, **antes** de describir siquiera el mutate.

**Prueba adversarial añadida:** `apps/api/test/multitenant-aislamiento.test.ts` — 17 pruebas que cubren los TEST 1…12 de la directiva (observaciones cruzadas en ambas direcciones, colisión de identificadores entre tenants, lectura del Director, bandeja de propuestas, intención con cuenta ajena, aprobación cruzada, executor con tenant discordante, mutate/rollback confinados, fail-closed por alcance forjado y por permiso ausente). **17/17 en verde.**

---

## 2. Clasificación de apariciones de SmileFlow

420 apariciones en 92 archivos. Clasificación:

### D — RIESGO CRÍTICO (bloquea la incorporación de una segunda organización)

| # | Ubicación | Qué ocurre | Consecuencia con un segundo tenant |
|---|---|---|---|
| **D-1** | `apps/api/src/measurement-routes.ts:17` — `const ORG_INGESTA_REAL = 'org-smileflow'` | Las rutas `/medicion/reales`, `/medicion/panel`, `/medicion/lectura-director`, `/medicion/plan-accion`, `/medicion/g2a-*` construyen su contexto desde esta **constante**, ignorando la organización autenticada que el gateway inyectó. | Un miembro autenticado de **cualquier** organización que llame a esas rutas recibe los **datos reales de Google Ads y Growth de SmileFlow**. Es una **lectura cross-tenant**. |
| **D-2** | `apps/api/src/pilot-decision-experience.ts:33` — `const ORG = 'smileflow-clinic'` | La experiencia de decisión del primer piloto real fija la organización en código. | Expone el expediente comercial de SmileFlow (identidad, presupuesto, criterios, prohibiciones) a cualquier organización autenticada. |
| **D-3** | `apps/api/src/real-director/lectura-director-real.ts` | `recalcular(org, ahora)` acepta **cualquier** organización pero aplica siempre `CAMPANIA_SMILEFLOW`, `CRITERIO_SMILEFLOW`, `POLICY_SMILEFLOW`, `OBJETIVO_SMILEFLOW`. | Si se invocara con `org-cyp`, escribiría en el stream de C Y P una lectura etiquetada con el `campaignId` y el objetivo de SmileFlow, y evaluaría a C Y P con el criterio de un funnel SaaS dental. **Contaminación de configuración**, aunque no de datos. |
| **D-4** | `apps/api/src/vertical-gateway.ts:14-17` (nota honesta ya presente en el código) | El gateway garantiza *seguridad* (sesión + membresía) de toda la superficie, pero **no** vincula cada experiencia al tenant autenticado. | Es la causa raíz común de D-1 y D-2: existe una clase completa de "experiencias con organización sintética" fuera del confinamiento. |

### B — DEUDA MULTITENANT (impide la segunda organización, sin fuga)

| # | Ubicación | Deuda |
|---|---|---|
| **B-1** | `apps/api/src/autonomia-ads/capacidad-negativa.ts:16` — `CONFINAMIENTO = { org, customerId, loginCustomerId } as const` | El confinamiento es una **constante global de un solo tenant**, no un registro de cuentas externas por organización. Es correcto como guardarraíl (fail-closed), pero ninguna segunda organización puede tener cuenta externa mientras siga siendo una constante. |
| **B-2** | `apps/api/src/autonomia-ads/limites-smileflow.ts` — `LIMITES_SMILEFLOW` | Topes de autonomía (presupuesto, CPC, cambios/día, cooldown) fijos para SmileFlow; consumidos por `g2a-service` y `plan-accion-service` sin parametrizar por organización. |
| **B-3** | `apps/api/src/real-director/criterio-smileflow.ts` | Objetivo, criterio, política y gasto autorizado son constantes de módulo, no configuración por organización. No existe todavía un modelo `organización → modelo de negocio → objetivos → KPIs → política de evaluación`. |
| **B-4** | `apps/api/scripts/ingest-all.ts:26` — `const ORG = 'org-smileflow'` | La ingesta autónoma (tarea programada) es **single-tenant por construcción**: una organización, un `GOOGLE_ADS_CUSTOMER_ID`, un `SMILEFLOW_M2M_URL`, un archivo `.env.google-ads` global. No hay registro de fuentes por organización. |
| **B-5** | `.env.google-ads` | Credenciales y `customerId` **globales del proceso**, no asociados a una organización. `SecretStoreEnv` resuelve `env:NOMBRE` sin scope: nada impide que el registro de la Org B apunte a la referencia de la Org A. |
| **B-6** | Experiencias con organización fija de demostración: `control-experience` (`pyme-ctrl-demo`), `content-experience` (`pyme-cont-demo`), `channel-experience` (`pyme-chan-demo`), `marketing-experience` (`pyme-mkt-demo`), `measurement-experience` (`pyme-met-demo`), `pilot-experience` (`pyme-piloto-demo`), `experiencia.ts` (`pyme-demo`) | Todas las organizaciones autenticadas **comparten** el mismo tenant de demostración. No filtran SmileFlow, pero sí violan el aislamiento entre organizaciones reales futuras. |
| **B-7** | UI (`apps/web`) | Existe `/select-organization`, pero sólo enruta a `/director-autonomo/programas?org=<slug>`. `/resultados`, `/medicion`, `/control`, `/piloto`, `/marketing` **no** están parametrizadas por organización. No hay selector de negocio global ni estado de onboarding por organización. |
| **B-8** | Identidad de SmileFlow inconsistente | Conviven **tres** identificadores para la misma empresa: `org-smileflow` (ingesta/Ads/Director), `smileflow-clinic` (decisión de piloto) y `smileflow` (fixture `piloto-director-v1`). Antes de añadir una segunda organización conviene fijar la convención (sin migración destructiva). |

### C — INOFENSIVA (tests, documentación, fixtures aislados)

- `packages/piloto-director-v1/src/fixture.ts`, `packages/piloto/src/fixtures-decision.ts` — fixtures nombrados y aislados. *(Nota: `fixtures-decision.ts` deja de ser inofensivo al ser servido por D-2.)*
- Comentarios ilustrativos (`provider: 'smileflow-growth'`) en `@soec/motor-medicion`.
- ~50 archivos de test y toda la documentación histórica (`MASTER_STATUS.md`, ADR, CHANGELOG).

### A — CORRECTAMENTE TENANT-SCOPED

- `SchedulerIngesta` (organización inyectada por constructor; streams `ingesta-estado:<provider>:<org>`).
- `IngestaGoogleAds` / `IngestaSmileFlowGrowth` (organización inyectada; el adaptador Growth es específico de SmileFlow **por ser su fuente**, lo cual es correcto).
- Todos los `*StreamId(org, …)` de los paquetes de dominio.
- `@soec/programas` `Negocio` (`negconf:<org>`): perfil comercial por organización con `industria`, `pais`, `moneda`, `zonaHoraria`. **Es el lugar natural para C Y P.**

---

## 3. Matriz de aislamiento

`AISLADA` responde: *¿resistiría hoy una segunda organización sin fuga ni contaminación?*

| CAPA | SMILEFLOW | C Y P | AISLADA |
|---|---|---|---|
| Organization | `org-smileflow` (+ `smileflow-clinic`, `smileflow`) | **PENDIENTE** (no creada) | ⚠️ parcial — identidad duplicada (B-8) |
| Configuration | constantes de módulo (`criterio-smileflow.ts`, `limites-smileflow.ts`) | **PENDIENTE** | ❌ **NO** (B-2, B-3, D-3) |
| Credentials | `.env.google-ads` global + `secreto:<org>:*` | **PENDIENTE** | ⚠️ parcial — registro por org ✅, resolución global (B-5) |
| Growth / e-commerce source | `SMILEFLOW_M2M_URL` (adaptador propio) | **PENDIENTE** | ⚠️ parcial — adaptador correcto, registro de fuentes inexistente (B-4) |
| Google Ads account | `customerId 8605…` / `login 1742…` (constante) | **PENDIENTE** | ❌ **NO** (B-1) |
| GA4 property | no conectada | **PENDIENTE** | n/a — capacidad inexistente |
| Merchant Center | N/A | **PENDIENTE** | n/a — capacidad inexistente |
| Persistence | `organization_id` en `events` + PK compuesta en 22 `proj_*` | idem | ✅ **SÍ** (probado) |
| M8 (observaciones) | `observacion:<org>:<id>` + índice `observacion-indice:<org>` | idem | ✅ **SÍ** (TEST 1-3) |
| Measurement | `med:<pub>` + `proj_med_current(org, instance)` | idem | ✅ **SÍ** (por filtro de store + PK) |
| M9 (optimización) | `opt:<id>` + `proj_optimizacion_current(org, opt)` | idem | ✅ **SÍ** |
| Director | `lectura-director:<org>` | idem | ⚠️ **datos SÍ / configuración NO** (D-3) |
| Recommendations | `autonomia-ads:<org>` | idem | ⚠️ igual que Director |
| Intentions | `intencion-ads:<org>:<id>` + índice por org + `CONFINAMIENTO_TENANT` | idem | ✅ **SÍ** (TEST 7) |
| Approvals | `aprobacion-ads:<org>:<id>` | idem | ✅ **SÍ** (TEST 8) |
| Executor | gate `CONFINAMIENTO_TENANT` + fail-closed | idem | ✅ **SÍ** (TEST 9, 9b) |
| Read-back | describir mutate rechaza `customerId` ajeno | idem | ✅ **SÍ** (TEST 10) |
| Rollback | confinado al `resource_name` del mismo tenant | idem | ✅ **SÍ** (TEST 11) |
| Audit | `identity_audit_events.organization_id` | idem | ✅ **SÍ** |
| Memoria / aprendizaje | `aprendizaje:<org>:<id>` + transferencia con decisión humana | idem | ✅ **SÍ** |
| UI | paneles sin selector de organización | **PENDIENTE** | ❌ **NO** (B-7) |
| Scheduler | organización inyectada; **el lanzador la fija a una sola** | **PENDIENTE** | ⚠️ motor ✅ / composición ❌ (B-4) |
| **Rutas de experiencia** | `/medicion/*`, `/piloto/decision`, demos `pyme-*` | — | ❌ **NO — RIESGO CRÍTICO** (D-1, D-2, D-4, B-6) |

**Ningún `PENDIENTE` se ha rellenado con un valor inventado.**

---

## 4. Aislamiento en persistencia — ¿puede cada recurso decir de qué organización es?

**Sí, en el nivel físico.** Toda fila de `events` porta `organization_id` y toda consulta lo filtra; toda fila de `proj_*` lo lleva en su clave primaria.

Matiz que conviene registrar: **muchos `streamId` no incluyen la organización en su cadena** (`med:<pub>`, `opt:<id>`, `plan:<id>`, `obj:<id>`, `brief:<id>`, `marca:<id>`, `pol:<id>`, `acc:<id>`, `oi:<id>`, `ens:<id>`, `exp:<id>`, y `orgindice` que es literal). Esto **no** produce fuga —el filtro por `organization_id` es la autoridad, y la prueba TEST 3 lo demuestra con identificadores colisionantes deliberados— pero deja el aislamiento dependiendo de una única capa. Recomendación (no bloqueante): incluir la organización en el `streamId` de los agregados nuevos, como ya hace la mayoría del código reciente.

`projection_checkpoints` tiene PK global `(projection)`: es un cursor de replay, no dato de tenant. Aceptable; anotado.

---

## 5. Diferencia de modelo de negocio (no ejecutada, sólo registrada)

SmileFlow es un funnel SaaS/clínico (`demo_cta_clicked → demo_form_started → demo_requested → lead_created`). Estos nombres **están cableados** en la presentación de `/resultados` (`FunnelCounts`) y en el mapeo de Growth. **No son universales** y no deben imponerse a C Y P.

`@soec/programas.Negocio` ya admite `industria`/`pais`/`moneda` por organización, pero **no existe** todavía el eslabón `organización → modelo de negocio → objetivos → KPIs → política de evaluación`. Construirlo es requisito para que el Director razone con contexto de e-commerce sin duplicar el motor.

Los eventos de e-commerce (`product_view`, `search`, `add_to_cart`, `begin_checkout`, `purchase`) **no se implementan aquí**: primero hay que verificar qué eventos existen realmente en la fuente de C Y P.

---

## 6. Capacidades de e-commerce — inventario honesto

| Capacidad | Estado |
|---|---|
| catálogo / SKU / disponibilidad / precio / categorías | **MISSING** — no existe modelo de producto en ningún paquete |
| feed / Merchant Center / Shopping | **MISSING** |
| conversion value / revenue | Parcial — `@soec/medicion` maneja `ingresos`/`gasto`/ROI, sin línea de producto |
| margin / costos | **MISSING** |
| cart / checkout / purchase / recompra | **MISSING** |
| **REQUIRED_NOW** | ninguna — no puede especificarse sin el discovery real de la fuente de C Y P |
| **REQUIRED_LATER** | catálogo, revenue por pedido, embudo e-commerce, Merchant Center |

---

## 7. Bloqueadores para continuar

**Técnicos (corregibles por SOEC, FASE 4):** D-1, D-2, D-3, D-4 y B-1…B-4. Hasta que D-1 y D-2 estén corregidos, **crear la organización C Y P la expondría inmediatamente a los datos reales de SmileFlow** al abrir cualquiera de esos paneles.

**Humanos (SOEC no puede resolverlos — se detiene y reporta):**

1. **Identidad legal y tributaria** de Distribuidora C Y P SpA (razón social exacta, RUT).
2. **Dominio / URL** del sitio o tienda. Una búsqueda web abierta **no** identificó la empresa; los resultados encontrados son de otras distribuidoras chilenas y **no se les atribuye relación alguna con C Y P**. Sin el dominio confirmado por el propietario, el discovery de FASE 8 no puede iniciarse sin inventar.
3. **Plataforma de e-commerce** (Shopify/WooCommerce/Jumpseller/Magento/propia) y si existe API o export de catálogo.
4. **¿Existe Google Ads?** `customer_id`, `login_customer_id` / manager, y confirmación de que la cuenta pertenece a C Y P.
5. **¿Existe GA4?** `property_id` y acceso de lectura.
6. **¿Existe Merchant Center?** `merchant_id`.
7. **Credenciales propias de C Y P** (nunca reutilizar las de SmileFlow, aunque el propietario sea el mismo).
8. **Decisión sobre el identificador de organización** (`org-cyp` u otro) y sobre unificar los tres identificadores actuales de SmileFlow.

Hasta que existan, el estado honesto es: `CYP_GOOGLE_ADS = NOT_CONNECTED`, `CYP_GA4 = PENDING`, `CYP_ECOMMERCE = PENDING`, `CYP_MERCHANT_CENTER = PENDING`. **CERO ≠ NO CONECTADO.**

---

## 7-bis. FASE 4 — Endurecimiento aplicado (rama `fix/multitenant-second-business-readiness`)

Autorizada tras el checkpoint. **Los 4 bloqueadores D están corregidos.** No se creó C Y P.

### Abstracción genérica introducida — `apps/api/src/plataforma/`

`organization → business → profile → sources → objectives → policies → external accounts → director context`

| Módulo | Rol |
|---|---|
| `identidad-organizacion.ts` | Separa **CANONICAL_ORG_ID** (`org-smileflow`, única clave de tenant) de **BUSINESS_KEY** (`smileflow-clinic`, id del negocio dentro de `@soec/piloto`) y **LEGACY_ALIAS** (`smileflow`). `assertTenantIdCanonico` **rechaza** un alias usado como tenant; la canonización es explícita y nunca ocurre en el camino de autorización. |
| `tipos.ts` | `NegocioRegistrado`, `BusinessEvaluationProfile`, `FuenteRegistrada`, `EstadoNegocio` (`CREATED→CONFIGURING→SOURCES_PENDING→OBSERVING→EVALUABLE`). Sin ninguna empresa dentro. |
| `negocios/org-smileflow.ts` | **SmileFlow como configuración registrada**, no como centro de la plataforma: su objetivo, criterio, política, límites, campaña y cuenta de Ads viven aquí. |
| `registro.ts` | `getBusiness/getProfile/getSources/getRecursoGoogleAds`. Resolución por clave exacta. **No existe `if (!orgConfig) useSmileFlowConfig()` en ninguna forma**: lanza. |
| `experience-binding.ts` | `bindExperienciaReal(ctx, experiencia)`: identidad canónica → `requireScope` → negocio registrado → experiencia habilitada → perfil → invariante estructural (negocio, perfil y fuentes de la MISMA organización). |
| `errors.ts` | `ORGANIZATION_NOT_CONFIGURED` (404) · `BUSINESS_PROFILE_NOT_CONFIGURED` (409) · `NO_DATA_SOURCE_CONFIGURED` (409) · `EXPERIENCE_BINDING_DENIED` (403) · `INVALID_ORGANIZATION_IDENTIFIER` (400). |

### Corrección por bloqueador

- **D-1** — `measurement-routes.ts`: eliminada `ORG_INGESTA_REAL`. Cada ruta REAL resuelve `contextoDe(req)` + `bindExperienciaReal`. La lista de proveedores ya no es global: sale del **registro de fuentes de esa organización**. Toda respuesta declara su `organizationId`.
- **D-2** — `pilot-decision-experience.ts`: eliminada `ORG = 'smileflow-clinic'`. Recibe `(store, org, ConfiguracionDecisionPiloto)`; `pilot-routes.ts` construye la experiencia **por petición**, tras binding.
- **D-3** — `lectura-director-real.ts`: eliminadas `CRITERIO_/POLICY_/CAMPANIA_/OBJETIVO_SMILEFLOW` del camino genérico. `recalcular(org)` resuelve `getProfile(org)`; sin perfil **lanza** y no escribe nada. Igual en `plan-accion-service.ts` y `g2a-service.ts`.
- **D-4** — binding explícito obligatorio antes de cualquier experiencia REAL; no se confía en nombre de ruta, query param, cabecera del cliente, campaignId ni configuración global.
- **Extra (B-1)** — el `CONFINAMIENTO` global pasa a `confinamientoDe(org)` desde el registro; `GoogleAdsWriteAdapter` recibe la cuenta autorizada por constructor; el Executor añade la puerta **`PERFIL_DE_NEGOCIO`** (fail-closed).
- **Extra (B-4/B-5)** — `ingest-all.ts` resuelve cuenta y referencias de credencial desde el **registro de fuentes**, no de variables globales.
- **Extra (B-7)** — `/resultados` y las observaciones reales exigen **negocio activo** (`?org=`); sin él muestran «no hay negocio seleccionado», y ante `*_NOT_CONFIGURED` muestran «no configurado» en vez de cero.

### Verificación

`typecheck` 48/48 · `eslint` limpio · `next build` OK · **suite 237 archivos / 1607 pruebas** (+43) · secret-scan del diff sin coincidencias · **ingesta autónoma real re-ejecutada: `GLOBAL_OK`, veredicto `OBSERVAR`, `DRY_RUN`, 0 intenciones, 0 mutate**.

### ⚠️ Incidente de datos durante la verificación (causado por este bloque)

Ejecutar la suite COMPLETA (`vitest run`) contra la base viva **trunca `events`**: 27 archivos `*.pg.test.ts` hacen `truncate table events, outbox, projection_checkpoints … cascade` y `DATABASE_URL` apunta a la base de producción local. Al correrla dos veces se borraron las observaciones reales de `org-smileflow`.

**Recuperado**: la ingesta es idempotente y re-leyó ambas fuentes (Google Ads 272 filas de su ventana de 7 días; Growth 29 desde cursor 0). El estado observacional actual es coherente.
**Perdido de forma no recuperable**: el histórico derivado (secuencia de `lectura-director`, `med`/`opt`, historial de `sync`) y cualquier observación de Ads anterior a la ventana de 7 días.
**Corregido en FASE 4.5** (ver abajo). La regla operativa provisional que se dio (`pnpm test:unit`) era además **insuficiente**: `--exclude '**/pg/**'` sólo excluía directorios llamados `pg`, de modo que `cia-routes.pg.test.ts` y cinco suites de API que truncan tablas `identity_*` seguían corriendo contra la base operativa.

## 7-ter. FASE 4.5 — Aislamiento estructural TEST DB ╪ RUNTIME DB

El blocker se cierra por construcción, no por convención. Nuevo contrato en
`packages/event-store/src/pg/test-db.ts` (`@soec/event-store/test-db`), con **cuatro capas**:

| Capa | Garantía |
|---|---|
| Resolución | `urlBaseDePrueba()` **nunca lee `DATABASE_URL`**. Sólo `SOEC_TEST_DATABASE_URL` o el default local `…/soec_test`. El patrón `DATABASE_URL ?? runtime` está erradicado del repositorio. |
| Contrato de nombre | `assertSafeTestDatabase` exige `NODE_ENV=test`, host local (o `SOEC_TEST_DB_ALLOW_REMOTE=true`), nombre con sufijo `_test`, y rechaza `soec`/`postgres`/`production` y proveedores gestionados (Railway, Neon, Supabase, RDS…) **incluso con el opt-in remoto**. |
| Guarda destructiva | `ejecutarDestructivoDePrueba(pool, sql)` pregunta a PostgreSQL `select current_database()` y revalida **antes de cada TRUNCATE**. No confía en el llamador ni en la cadena de conexión, sino en la base realmente conectada. |
| Convención mecánica | Toda prueba que abre un pool se llama `*.pg.test.ts` o vive en `test/pg/`. Una prueba de arquitectura recorre el repositorio y falla si alguien reintroduce el patrón, se salta la guarda, o abre PostgreSQL fuera de la convención. |

**Cambios**: 24 suites migradas a `makeTestPool()` + `ejecutarDestructivoDePrueba`; 5 suites de API renombradas a `*.pg.test.ts` (`auth-api`, `csrf-api`, `seguridad-api`, `generacion-api`, `commercial-knowledge-api`); `vitest.unit.config.ts` / `vitest.pg.config.ts` / `vitest.shared.ts`; `globalSetup` que **crea `soec_test` si falta y nunca toca `soec`**; scripts `test` · `test:unit` · `test:pg`.

**Prueba decisiva** (huella sobre un corte temporal fijo, para no confundir con las escrituras del scheduler vivo):

```
CORTE                = 2026-08-14 01:45:27+00
RUNTIME_BEFORE (<=T) = n=595 streams=300 hash=ff3c8cc577806176e8cee6811476a342
suite COMPLETA       = 239 archivos · 1627 pruebas · PASS
RUNTIME_AFTER  (<=T) = n=595 streams=300 hash=ff3c8cc577806176e8cee6811476a342
RUNTIME_DATA_CHANGED = NO
soec_test            = truncada y reconstruida libremente (events=0 al terminar)
```

Las únicas escrituras posteriores al corte en `soec` son de `actor_id = ingesta-scheduler`: el runtime haciendo su trabajo, no las pruebas.

## 7-quater. FASE 5 — Incorporación de Distribuidora C Y P SpA

Segunda organización real creada como **configuración registrada** (`plataforma/negocios/org-cyp.ts`),
sin tocar el núcleo. El registro pasó a `crearResolutorDeNegocios(configs)`: incorporar una
organización es añadir su módulo y una línea, nada más.

### Identidad — cuatro conceptos separados

```
organizationId (tenant) = org-cyp
businessKey             = distribuidora-cyp
displayName             = Distribuidora C Y P
legalName               = Distribuidora C Y P SpA
RUT                     = null  ← pendiente del propietario, NO se inventa
```

`getBusiness('distribuidora-cyp')` lanza: la businessKey no es una clave de tenant.

### Estado y perfil — honestidad por diseño

`estado = SOURCES_PENDING` (no `OBSERVING`: no hay nada de dónde observar).
`perfil = null` ⇒ `getProfile('org-cyp')` lanza `BUSINESS_PROFILE_NOT_CONFIGURED`.

**No se copió nada de SmileFlow** y **no se fijó ningún objetivo comercial**: ni ROAS, ni CPA, ni
ticket, ni margen, ni tasa de conversión, ni presupuesto. Una prueba verifica que la configuración
no contiene ninguno de esos campos. `experienciasHabilitadas = []`: ninguna experiencia REAL se
vincula a C Y P.

### Registro de fuentes — estado real de cada una

| Fuente | Estado | Falta |
|---|---|---|
| WEBSITE | NOT_CONNECTED | dominio/URL confirmado |
| ECOMMERCE | NOT_CONNECTED | plataforma + acceso de lectura |
| GOOGLE_ADS | NOT_CONNECTED | `customer_id`, `login_customer_id`, credencial propia |
| GA4 | NOT_CONNECTED | `property_id`, acceso de lectura |
| MERCHANT_CENTER | NOT_CONNECTED | `merchant_id`, acceso de lectura |
| SALES | NOT_CONNECTED | fuente autorizada de historial |
| CATALOG | NOT_CONNECTED | acceso de lectura a catálogo/SKU |
| CRM | NOT_CONNECTED | sistema de clientes, si existe |
| PAYMENTS | NOT_CONNECTED | medios de pago en uso |
| SHIPPING | NOT_CONNECTED | operador y cobertura |

Ninguna `credentialRef`, ningún `externalAccountId`. `CERO ≠ NO CONECTADO`: la UI muestra
«no conectada» + lo que falta, nunca un cero.

### UI multiempresa

Nueva vista `/negocios` («Mis negocios»): **selector**, no portafolio. Lista nombre y estado de
incorporación; ninguna cifra comercial, ninguna cuenta externa. Al entrar en un negocio, todo el
panel queda acotado a él. Nueva ruta `GET /plataforma/negocio` que **no exige perfil**, para que una
organización recién incorporada pueda describirse honestamente.

**Limitación declarada**: `GET /plataforma/negocios` no filtra por membresía porque el plano de
identidad todavía no tiene organizaciones dadas de alta. Antes de que SOEC sea multi-usuario, esa
lista DEBE filtrarse por las membresías del usuario autenticado.

### Discovery — BLOQUEADO

§9 exige auditar la tienda real en solo lectura. **No hay URL ni dominio confirmado**, así que el
discovery no se inició: cualquier sitio que eligiéramos sería una atribución inventada. Bloqueado a
la espera del dominio.

### Capacidades de e-commerce que SOEC aún no tiene

| Capacidad | Estado |
|---|---|
| catalog · sku · product · category · stock · price | **MISSING** |
| merchant feed · Shopping | **MISSING** |
| order · cart · checkout · purchase | **MISSING** |
| margin · costos | **MISSING** |
| repeat purchase · cohortes | **MISSING** |
| shipping (cobertura, costo) | **MISSING** |
| revenue / conversion value | **EXISTS parcial** — `@soec/medicion` maneja ingresos/gasto/ROI sin línea de producto |
| observación multi-proveedor con procedencia | **EXISTS** — `@soec/motor-medicion` es agnóstico del proveedor |
| **REQUIRED_NOW** | ninguna: nada puede especificarse sin el discovery real |
| **REQUIRED_LATER** | catálogo, pedido/revenue, embudo e-commerce, Merchant Center, margen |

Los eventos de e-commerce (`product_view`, `search`, `add_to_cart`, `begin_checkout`, `purchase`)
**no se implementaron**: primero hay que verificar qué eventos existen realmente en la fuente de C Y P.

### Extensibilidad probada

`THIRD_ORG_CAN_BE_REGISTERED_WITHOUT_CORE_CHANGE`: una tercera organización **ficticia y de prueba**
se registra con `crearResolutorDeNegocios([...])` sin modificar el núcleo, y sigue siendo fail-closed
(sin perfil no evalúa, no hereda el de nadie). No se incorpora al despliegue.

### Verificación

`typecheck` 48/48 · `eslint` limpio · `next build` OK · **suite completa 240 archivos / 1648 pruebas**
(+21 de C Y P) · huella del runtime idéntica antes y después · secret-scan sin coincidencias reales.

## 7-quinquies. FASE 6B — Fundamentos y observabilidad real de C Y P

Tras el discovery de solo lectura de `https://distribuidoracyp.cl/`, C Y P deja de ser una ficha vacía.

### Modelo genérico de comercio — `@soec/comercio` (paquete nuevo)

No nombra ninguna empresa ni plataforma: `CommerceProduct`, `CommerceCategory`, `CommercePrice`,
`CommerceCart`, `CommerceCheckout`, `CommerceOrder`, `CommerceRevenue`, `CommerceDataQualityFinding`.
Tres invariantes están impuestos **por tipo**, no por convención:

1. **El SKU no es clave.** La identidad es `organizationId + source + externalId`. Con 129/129
   productos sin SKU, usarlo como clave habría colapsado el catálogo en una sola entidad.
2. **Desconocido ╪ cero.** `DesconocidoOValor` obliga a mirar `conocido` antes de leer `valor`; un
   paso de embudo `NO_INSTRUMENTADO` **no tiene** campo `eventos`, así que no puede reportar 0.
3. **Sólo lectura.** `CommerceCatalogSource` no declara ninguna operación de escritura.

### Adaptador WooCommerce — solo lectura demostrable

`GET` fijo en código, lista blanca cerrada (`/products`, `/products/categories`), sin credenciales
ni cookies. Una prueba lee el propio código fuente (sin comentarios) y falla si aparece cualquier
`method: 'POST'|'PUT'|'DELETE'|'PATCH'` o una ruta `/cart`, `/checkout`, `/orders`, `/batch`.

### Snapshot REAL ingerido (solo lectura sobre producción)

| | |
|---|---|
| PRODUCTS_DISCOVERED | **129** |
| CATEGORIES_DISCOVERED | **15** |
| PRICE_RANGE | **500 – 40.000 CLP** |
| IN_STOCK / OUT_OF_STOCK | **125 / 4** |
| PRODUCTS_WITH_SKU | **0** |
| PRODUCTS_WITH_BRAND | **0** |
| PRODUCTS_WITH_ATTRIBUTES | **0** |
| PRODUCTS_WITH_IMAGE / PRICE | **129 / 129** |
| Relación producto↔categoría demostrable | **112 de 129** |

**Corrección al discovery previo:** la anomalía de taxonomía existe pero es **parcial**, no total.
Con `per_page=100`, 112 productos sí exponen su categoría y **17 llegan con `categories: []`**. Esos
17 quedan marcados `NO_DEMOSTRABLE` — no se les inventa categoría. Las categorías se ingieren igual
por su propio endpoint, como fuente independiente.

Hallazgos de calidad (SOEC observa, no corrige): `MISSING_SKU` 129/129 · `MISSING_BRAND` 129/129 ·
`MISSING_ATTRIBUTES` 129/129 · `PRODUCT_CATEGORY_LINK_NOT_DEMOSTRABLE` 17/129 ·
`DUPLICATE_PRODUCT_CANDIDATE` 2 · `DUPLICATE_CATEGORY_NAME` 6/15 ·
`CATEGORY_NAME_WITH_INVISIBLE_CHARS` 1/15 (un nombre de categoría lleva un carácter invisible que
rompe coincidencias exactas y feeds).

### Estado real de las fuentes de C Y P

`WEBSITE` `ECOMMERCE` `CATALOG` `SOCIAL` = **OBSERVED** · `ANALYTICS` `TAG_MANAGER` `ADS`
`MERCHANT` `CRM` = **NOT_CONFIGURED** · `SALES` `PAYMENTS` = **CREDENTIALS_REQUIRED** ·
`SHIPPING` = **PARTIAL_CONFIGURATION** · `WHATSAPP` = **CONNECTED_UNKNOWN**.
Estado del negocio: **SOURCES_PARTIAL**.

El envío «$0» del checkout **no** se interpreta como ingreso ni costo cero: es `PAGO_EXTERNO`.
WhatsApp opera de verdad pero su contribución comercial es `desconocida`: no se le atribuye venta
alguna, y por tanto WooCommerce **no** se asume como el 100% de los ingresos.

### Perfil comercial ╪ política de evaluación

Se separaron dos conceptos que estaban fundidos:

- **`PerfilComercial`** — qué ES el negocio: `ECOMMERCE_DISTRIBUCION`, `CL`, `CLP`, orientación
  `B2B_LEAN` (sin imponer B2B puro: el checkout admite consumidor final), verticales `DENTAL` /
  `INDUSTRIAL_CLEANING` / `GENERAL_DISPOSABLES` — **sin línea MEDICAL**, que el discovery no
  encontró como vertical propia. Toda su economía (`ticket`, `margen`, `CAC`, `CPA`, `ROAS`, `LTV`,
  `recompra`, `devolución`, `costo de envío`) está declarada **desconocida**, jamás cero.
- **`BusinessEvaluationProfile`** — la política (objetivo, criterio, cuenta externa). C Y P sigue en
  `null`: fijarla sin datos sería inventarla.

### Director: FOUNDATION_REQUIRED

`evaluarFundamentos` produce un veredicto determinista y explicable.
C Y P → **`FOUNDATION_REQUIRED`**, con motivos `ANALYTICS_NOT_CONFIGURED`, `SALES_NOT_CONNECTED`,
`ECONOMICS_UNKNOWN`, `NATIONWIDE_SHIPPING_NOT_READY`, `ADS_NOT_CONFIGURED`,
`BUSINESS_PROFILE_NOT_CONFIGURED` — y reconoce lo que sí está (catálogo observable, modelo y canales
identificados). No es el `OBSERVAR` de SmileFlow: ahí hay datos insuficientes; aquí no hay de dónde
sacarlos. `puedeRecomendarInversionPublicitaria` es del **tipo literal `false`**: habilitarla exigirá
cambiar el contrato, no los datos.

### Verificación

`typecheck` 49/49 · `eslint` limpio · `next build` OK · **suite completa 241 archivos / 1666 pruebas**
(+18 de comercio) · huella del runtime idéntica antes y después · secret-scan sin coincidencias.

## 7-sexies. FASE 7 — Ventas reales de C Y P en solo lectura

### Credenciales

Depósito local por organización (`.secrets/<org>.env`, gitignored). `SecretStoreArchivo` exige
**triple coincidencia** de organización antes de tocar el archivo. Referencias opacas
`file:org-cyp/woocommerce-cyp-consumer-key|…-secret`. La credencial viaja **sólo** en
`Authorization: Basic`, nunca en la URL — hay un invariante en el adaptador que aborta si aparece
en la cadena de consulta.

`AUTHENTICATION = PASS · READ_ORDERS = PASS · READ_PRODUCTS = PASS` (HTTP 200).

### Adaptador privado — solo lectura por CÓDIGO, no por permiso

`method: 'GET'` fijado; lista blanca cerrada `/system_status`, `/orders`, `/products`; ninguna
función de escritura en el módulo. Una prueba lee el propio fuente (sin comentarios) y falla si
aparece cualquier método mutante, `/batch`, `/cart` o un nombre como `crearPedido`. **Aunque la
credencial fuera de escritura, este adaptador no podría mutar nada.**

### Ventas observadas — coherentes con la auditoría previa

| | Auditoría previa | SOEC (lectura propia) |
|---|---|---|
| Pedidos | 16 | **16** ✓ |
| Rango | 2025-01-19 → 2026-08-04 | **idéntico** ✓ |
| Ingreso observado | 570.420 CLP | **570.420 CLP** ✓ |
| Ticket promedio | 35.651 CLP | **35.651 CLP** ✓ |
| Artículos/pedido | ~3 | **3,44** ✓ |

Sin anomalías críticas. Hallazgos añadidos: **los 16 pedidos tienen evidencia de pago CONFIRMADA**
pese a estar todos en `processing` — exactamente el caso que la directiva anticipó y que el modelo
trata como tres ejes independientes (estado ≠ pago ≠ entrega). Una línea de pedido referencia un
producto ya inexistente en el catálogo (`(desconocido)`), y se declara como tal.

**Concentración:** 5 clientes seudónimos generan los 16 pedidos, y **los 5 son recurrentes**; los 5
productos mayores concentran el **76%** del ingreso. Es un patrón B2B de cartera pequeña, no un
e-commerce de tráfico.

### Privacidad

Persisten: id externo, fechas, estado, moneda, totales, medio de pago, método de envío, líneas con
`product_id`, y geografía comercial (país/región/ciudad). **No persisten**: nombre, dirección,
email, teléfono, RUT, IP ni notas. Verificado en la base: **0 eventos de `org-cyp` contienen `@`**.

La recurrencia se mide con HMAC-SHA256 usando una clave propia de la organización (generada por
SOEC y guardada en su depósito). La organización entra además en el mensaje: la misma persona en dos
organizaciones produce huellas **distintas**, así que ni comparando huellas se puede cruzar tenants.

### Idempotencia — un defecto encontrado y corregido

La primera implementación comparaba pedidos con `JSON.stringify`. PostgreSQL `jsonb` **reordena las
claves**, de modo que todo pedido releído parecía modificado: la segunda corrida reportó «16
actualizados» en vez de «16 sin cambios». Corregido con serialización canónica (claves ordenadas
recursivamente). Corridas 3 y 4: **0 nuevos, 0 actualizados, 16 sin cambios**. Quedaron en la
historia 16 eventos redundantes de la corrida 2; son append-only y la lectura toma el último, así
que no alteran ninguna cifra.

### Director

Sigue en **`FOUNDATION_REQUIRED`**. `SALES_NOT_CONNECTED` desaparece; permanecen
`ANALYTICS_NOT_CONFIGURED`, `ECONOMICS_UNKNOWN` (ahora afinado: *el ticket ya es observable, falta
el COSTO y el MARGEN*), `NATIONWIDE_SHIPPING_NOT_READY`, `ADS_NOT_CONFIGURED` y
`BUSINESS_PROFILE_NOT_CONFIGURED`. `puedeRecomendarInversionPublicitaria` sigue siendo del tipo
literal `false`.

### Verificación

`typecheck` 49/49 · `eslint` limpio · `next build` OK · **suite 243 archivos / 1703 pruebas** (+21)
· huella del runtime idéntica antes y después · secret-scan sin coincidencias · `.secrets` fuera de git.

## 8. Estado de la gobernanza al cierre de este documento

```
AUTONOMOUS_REAL              = FALSE
REAL_GOOGLE_ADS_MUTATE_CALLS = 0
GOOGLE_ADS                   = READ ONLY
G2-A                         = FUNCIONALMENTE INTACTO (sólo wiring al registro por organización)
G2-B                         = NO AUTORIZADO / NO INICIADO
SMILEFLOW EXTERNO            = NO MODIFICADO (campañas, presupuestos, GA4, landing)
D-1..D-4                     = CORREGIDOS
TEST_DB ╪ RUNTIME_DB         = AISLADAS ESTRUCTURALMENTE
CYP_ORGANIZATION_CREATED     = SÍ (org-cyp · SOURCES_PENDING · sin perfil · sin fuentes conectadas)
CYP_MARKETING                = NO INICIADO (sin campañas, sin presupuesto, sin anuncios)
DISCOVERY C Y P              = BLOQUEADO (falta dominio/URL)
```
