# Meta — Plan de onboarding READ-ONLY (próximo capítulo)

> Este documento NO conecta nada. Es el plan del próximo bloque. Fuentes primarias consultadas en
> ago-2026 (ver §Referencias). Nada se ejecuta hasta que exista decisión de proveedor + credenciales +
> consentimiento del usuario.

## 1. Investigación de la API oficial (FASE 1)

| Campo | Valor (ago-2026) |
|---|---|
| `META_API_VERSION` | **v26.0** (Graph API + Marketing API; publicada 2026-07-29). v23.0 EOL 2026-06-09; v20 se deprecia 2026-09-24. |
| `REQUIRED_PERMISSIONS` (lectura ads) | `ads_read` (Marketing API), sobre un ad account del Business. |
| `REQUIRED_PERMISSIONS` (IG orgánico) | `instagram_basic` + (publicación) `instagram_content_publish` / `instagram_business_content_publish`; requiere **Instagram Professional** vinculada a una **Facebook Page**. |
| `REQUIRED_PERMISSIONS` (Pages) | `pages_show_list`, `pages_read_engagement` (+ `pages_manage_posts` sólo si se publicara). |
| `REQUIRED_PERMISSIONS` (Lead Ads) | `leadgen_download` (+ webhooks `leadgen`) — sólo si se usan instant forms. |
| `REQUIRED_ACCOUNT_TYPES` | Business Portfolio (Business Manager) · Facebook Page · Instagram Professional · Ad Account · Meta App. |
| `APP_REVIEW_REQUIRED` | **Sí** para Advanced Access (publicar/leer en cuentas que no son propias). Screencast por permiso; ~2–4 semanas por envío. |
| `BUSINESS_VERIFICATION_REQUIRED` | **Sí** para Advanced Access / producción. |
| `TOKEN_TYPES` | User access token, Page access token, y **System User token** (recomendado para servidor-a-servidor vía Business Manager). |
| `RATE_LIMITS` | Platform rate limiting + **BUC (Business Use Case)** rate limiting en Marketing API, por tier del ad account. |
| `KNOWN_LIMITATIONS` | Advantage+ Shopping/App ya no se crean/editan por Marketing API (deprecación por fases). v26: placement Instagram Explore da error; Messenger Stories se elimina en silencio. Métricas de reach/impressions de posts/página en migración a Media Views / Media Viewers (jun-2026). Publicación IG = 2 pasos (`/media` → `/media_publish`). |

## 2. Arquitectura de conexión (mirror del patrón Google Ads)

- **Lectura:** `MetaReadAdapter extends AdaptadorRealBase` (en `apps/api`), `capacidad='ingesta-meta'`,
  host allowlist `graph.facebook.com`, egress tipado, `invocar()` sólo GET. Servicio `IngestaMeta` con
  degradación `OK/PARCIAL/FALLO`. Secretos por `SecretStore` (`file:<org>/meta-*`), nunca en logs/eventos.
- **Escritura:** `MetaWriteAdapter` — clase separada, credencial propia (valor ausente), whitelist de
  capacidades Meta, `assertSimulado('REAL')` en el path real, confinamiento por `adAccountId`/`pageId`.
  Reutiliza `CredencialWrite` + `estadoCapacidadWrite` + `preMutateCheck` sin cambios (provider-neutral).
- **Config por org:** añadir `'meta'` a `CuentaExternaRef.proveedor`, entradas `cuentasExternas`/
  `FuenteRegistrada` (`tipo:'SOCIAL'`/`'ADS'`, credenciales por referencia) y un `getRecursoMeta(org)`
  espejo de `getRecursoGoogleAds`. Refs secretos lógicos: `meta-app-secret`, `meta-page-token`,
  `meta-ig-token`, `meta-ad-account`. **Sin valores en código/logs/eventos/UI.**

## 3. Secuencia (sin ejecutar)

1. Identificar activos reales (Business, Page, IG Professional, Ad Account).
2. Crear Meta App (cuando haya decisión de proveedor/credenciales).
3. Permisos + estrategia de token (preferir System User).
4. App Review / Business Verification si aplica.
5. Conexión **read-only** (detección de capacidades).
6. Inventario inicial (cuentas/campañas/insights/páginas/IG) en shadow.
7. Recién entonces evaluar un canary orgánico (menor riesgo que paid) — diseño, no ejecución.

## 4. Gate

`REAL_CONNECTION = NO`. No se crea Meta App, no se generan tokens, no se publica, no se crea campaña,
no se gasta, no se habilita escritura Meta. `AUTONOMOUS_REAL` permanece `false`.

## 5. Onboarding read-only — estado y GATE DE AUTORIZACIÓN (rev. 2026-08-15)

Investigación oficial refrescada (no de memoria): Graph/Marketing API **v25.0** (feb-2026), **v26.0** en curso (ago-sep 2026).

**Permisos de LECTURA requeridos por capacidad** (nombres vigentes):
`READ_PAGES` → `pages_show_list` + `pages_read_engagement`; `READ_INSTAGRAM_ACCOUNT`/`READ_ORGANIC_MEDIA`/`READ_ORGANIC_INSIGHTS` → `instagram_basic` (+ IG Professional vinculada a una Page); `READ_AD_ACCOUNT`/`READ_CAMPAIGNS`/`READ_ADSETS`/`READ_ADS`/`READ_AD_INSIGHTS` → `ads_read`; `READ_LEADS` → `leads_retrieval` + `pages_show_list` (+ `pages_manage_ads`).

**GATE DE AUTORIZACIÓN — el onboarding real está BLOQUEADO (por diseño) hasta acción humana:**
- `META_APP_REQUIRED = YES` — se necesita una App de Meta aprobada. Crearla exige identidad de negocio + aceptar términos de Meta → **acción humana** (Claude no crea apps, no acepta términos, no hace login OAuth, no ingresa credenciales).
- `APP_REVIEW_REQUIRED = YES` — App Review por permiso (~20 días en 2026) para leer activos que no son propios (Advanced Access).
- `BUSINESS_VERIFICATION_REQUIRED = YES` — para permisos avanzados; Business Manager idealmente 30-60 días, admin con 2FA, documentos legales.
- `OAUTH_GRANT = NO` — no hay grant/token disponible; el usuario debe autorizar.
- `META_ASSETS_KNOWN = NONE` — ni SmileFlow ni C Y P tienen activos Meta configurados hoy → todos `NOT_CONFIGURED` (no se inventan Page/IG/Ad Account/Business).

Estas condiciones son exactamente las STOP CONDITIONS del bloque → **STOP antes de conectar**.

**Estrategia de token (a usar cuando exista App aprobada):** para lectura de Pages/IG, **Page access token** derivado de un User long-lived; para servidor-a-servidor multi-cuenta, **System User token** (Business Manager). Nunca password, nunca cookies. Tokens SÓLO en `SecretStore` (`file:<org>/meta-*`), jamás en event store/logs/UI/commits/docs.

**Preparado en este bloque (sin conexión, sin red, sin tokens):** modelo de activos Meta distintos (`apps/api/src/acquisition/meta-assets.ts`: Business/Page/Instagram/AdAccount/Pixel/App, tenant-scoped, refs opacas por activo, binding explícito, salud de conexión, modelo de token sin valor, allowlist de operaciones de LECTURA default-deny, normalizador de `action_type` que nunca suma-todo). Adversariales en `apps/api/test/acquisition-meta-assets.test.ts`.

**Secuencia humana para desbloquear (próximo paso, fuera de este bloque):** (1) confirmar si cada negocio tiene activos Meta; (2) crear/designar la App de SOEC (tipo Business; productos: Facebook Login, Pages API, Instagram Graph, Marketing API, Lead Ads); (3) Business Verification; (4) App Review de los permisos de lectura; (5) el dueño autoriza vía OAuth y selecciona explícitamente los activos por empresa; (6) recién entonces SOEC implementa las llamadas Graph READ contra la App aprobada.

## 6. REAL ASSET DISCOVERY — CLAUDE CHROME (2026-08-15)

Discovery de solo lectura ejecutado por Claude‑in‑Chrome sobre la sesión Meta del usuario (un único
perfil admin; **nombre omitido por privacidad**). Sin PII persistida (sin email/teléfono/tokens/
billing/leads). Clasificación: **OBSERVED** (visto con ID), **UNKNOWN**, **REQUIRES_VERIFICATION**.
Regla dura: *activo existe* ╪ *SOEC conectado* — `SOEC_META_GRAPH_CONNECTION = NOT_CONNECTED`,
`META_GRAPH_CALLS = 0`.

**SmileFlow — `FOUNDATION_CLASS = FRAGMENTED_RESTRICTED_RECOVERABLE`** (orgánico sano, Ads restringido;
`RELATION = FIRST_PARTY`, `ACCESS_REQUIREMENT = TO_BE_DETERMINED_PER_PERMISSION`):

| ASSET_TYPE | ASSET_ID | OWNER_BUSINESS_ID | EXTERNAL_STATUS | SOEC_CONN | PROC | CONFIRM |
|---|---|---|---|---|---|---|
| META_BUSINESS | 934186066270538 | 934186066270538 | RESTRICTED (verif. REJECTED, ads restringido) | NOT_CONNECTED | OBSERVED | YES |
| FACEBOOK_PAGE | 61570785690749 | 934186066270538 | EXISTS | NOT_CONNECTED | OBSERVED | YES |
| INSTAGRAM_PROFILE | 33006160107 | 934186066270538 | EXISTS (BUSINESS, CLEAN, organic AVAILABLE) | NOT_CONNECTED | OBSERVED | YES |
| INSTAGRAM_BUSINESS_ACCOUNT (IGSID) | UNKNOWN | — | UNKNOWN | NOT_CONNECTED | REQUIRES_VERIFICATION | YES |
| META_AD_ACCOUNT | 1037025024374407 | fuera del portfolio | EXISTS | NOT_CONNECTED | OBSERVED | YES |
| DATASET | 972064645294895 | — | UNKNOWN | NOT_CONNECTED | REQUIRES_VERIFICATION | YES |
| META_APP | UNKNOWN | — | UNKNOWN | NOT_CONNECTED | REQUIRES_VERIFICATION | YES |
| WHATSAPP_BUSINESS_ACCOUNT | (presencia) | — | EXISTS (presence VERIFIED; API NOT_VERIFIED) | NOT_CONNECTED | OBSERVED | YES |
| LEAD_FORM | (existen) | — | EXISTS (lead campaigns + forms) | NOT_CONNECTED | OBSERVED | YES |

Capacidades **independientes** (Ads restringido NO cascada): `ORGANIC_FACEBOOK = AVAILABLE`,
`ORGANIC_INSTAGRAM = AVAILABLE`, `META_ADS = RESTRICTED`, `LEAD_ADS = RESTRICTED`,
`API_READ = NOT_CONNECTED`, `API_WRITE = NOT_CONNECTED`. Notas: **Instagram Profile ID (33006160107) ╪
IGSID de Graph** (el IGSID se descubre por API; el candidato observado NO se persiste). **Meta App
`972064645294895` CONFIRMADA** ("SmileFlow", Development); su relación con el **Dataset** sigue sin
distinguir (`APP_CONFIRMED_DATASET_UNVERIFIED`).

**Evidencia Graph verificada (bloque de discriminación de Pages, token de prueba `pages_show_list`):**
- `GET /934186066270538?fields=id,name` → **200 OK** ("SmileFlow Clinic"). El **nodo del Business es
  legible por Graph pese a la restricción de Ads + verificación rechazada + bloqueo en la UI de Business
  Settings** ⇒ `RESTRICTION_PROPAGATES_TO_GRAPH_READ = NO` (corrige la hipótesis previa: la restricción
  vive en la capa de Ads/UI, no en la de lectura de la API).
- `GET /{business-id}/owned_pages` → **400 OAuthException** *"Requires business_management permission"*
  ⇒ `FAILURE_CLASS = BUSINESS_PERMISSION` (determinado, Meta nombra el permiso; **no** es restricción,
  ownership ni app-binding). Meta pide la llave, no oculta el activo.
- **Page ID canónico de Graph = UNKNOWN** hasta ejecutar `owned_pages` con `business_management`. El
  `61570785690749` queda como **`UNVERIFIED_LEGACY_UI_ID`** (vino de `profile.php?id=`), NO como Graph
  Page ID. SC Topografía (Page clásica) sí apareció por `/me/accounts` con Graph ID `100558733139736`
  → `UNBOUND / DO_NOT_BIND`.
- **Gate abierto (decisivo):** `business_management` no llegó al token pese a la aprobación. Falta
  confirmar si el diálogo OAuth **ofrece** ese permiso dado el portfolio con verificación rechazada. Si
  NO lo ofrece ⇒ la verificación rechazada bloquea permisos de nivel negocio y el rebuild pasa de
  recomendable a **obligatorio**; si sí lo ofrece ⇒ SmileFlow es recuperable para lectura de Pages.

**C Y P — `FOUNDATION_ABSENT` bajo el perfil inspeccionado** (no "C Y P no existe en Meta"): sin
Portfolio/Page/IG/AdAccount/Pixel/App observados → todo `NOT_CONFIGURED`.

**Activo externo no vinculado:** *SC Topografía e Ingeniería* (PAGE_ID 100095553750707) →
`UNBOUND / DO_NOT_BIND`. Administrado por el mismo humano, pero SOEC **no** lo auto‑vincula: prueba de
que el binding es explícito, por ID y por tenant (nunca por nombre ni por admin compartido).

Modelo en `apps/api/src/acquisition/meta-assets.ts` (+ `meta-discovery.ts`); adversariales en
`apps/api/test/acquisition-meta-assets.test.ts`.

## 7. VERIFIED ORGANIC GRAPH CHAIN (2026-08-15)

Cadena de LECTURA orgánica **verificada por Graph** (token de prueba con `pages_show_list` +
`business_management`; SOEC sigue sin conectarse — `META_GRAPH_CALLS_FROM_SOEC = 0`):

```
Business 934186066270538 (SmileFlow Clinic)
  ↓ owned_pages (business_management)
Facebook Page 1066708446525633 (Smileflow.clinic)   ← Graph Page ID CANÓNICO
  ↓ linked IG business account
Instagram Business Account (IGSID) 17841432883225770 (BUSINESS)
  ↓ media
11 media (IMAGE/FEED = 7 · VIDEO/REELS = 4)
  ↓ media insights (reach/views/likes/comments/saved/shares/total_interactions; reels: watch time en ms)
  ↓ account insights
```

**IDs canónicos (Graph):** business `934186066270538`, page `1066708446525633`, igsid `17841432883225770`.
**IDs NO canónicos (UI, `doNotUseForGraph`):** FB `61570785690749` (`profile.php`), IG profile `33006160107`.

| Capacidad | Estado |
|---|---|
| BUSINESS_GRAPH_READ / OWNED_PAGES / FACEBOOK_PAGE_READ | **PASS** |
| INSTAGRAM_BASIC / MEDIA / MEDIA_INSIGHTS / ACCOUNT_PERFORMANCE / CURRENT_FOLLOWER_COUNT (80) | **PASS** |
| INSTAGRAM_AUDIENCE_DEMOGRAPHICS | **NO_DATA** (200 + `data:[]`; NO "privacy threshold" probado) |
| FOLLOWER_GROWTH_OVER_TIME | **UNKNOWN** (sin histórico; no se infiere) |
| ADS_READ / LEAD_ADS_READ | **NOT_TESTED** |
| INSTAGRAM_WRITE / META_WRITE | **LOCKED** |

**`READ_FOUNDATION = RECOVER_EXISTING_APP`** (la cadena funciona sobre la app existente `972064645294895`).
**`ADS_FOUNDATION = UNRESOLVED / NOT_TESTED`** — el portfolio sigue con **restricción publicitaria**; que
organic funcione NO implica que Ads funcione. La restricción no desapareció.

**Seguridad (hardening):** las respuestas Graph de insights traen `paging.next/previous` con
`access_token=<SECRET>`. `apps/api/src/acquisition/meta-organic.ts` centraliza la sanitización
(`sanitizarGraph`/`redactarUrl`/`serializarSeguro`): redacta `access_token`/`appsecret_proof`, descarta
las URLs de paging completas (conserva sólo cursors) **antes** de cualquier log/telemetría/persistencia.
`RAW_GRAPH_RESPONSE_PERSISTENCE = FORBIDDEN`. Semántica de métrica explícita
(`VALUE/ZERO/NO_DATA/NOT_SUPPORTED/PERMISSION_MISSING/…`): nunca `null/missing/error → 0`. Watch time en
**milisegundos** (no se convierte). Adversariales en `apps/api/test/acquisition-meta-organic.test.ts`.

## 8. VERIFIED META ADS GRAPH CHAIN (2026-08-16)

Lectura de **Ads verificada por Graph** (`ads_read` Standard; token de prueba). SOEC sigue sin
conectarse: `META_GRAPH_CALLS_FROM_SOEC = 0`.

- **VERIFIED:** App `972064645294895` (Development) · Ad Account `1037025024374407` ("Caceres SC",
  status 1, **CLP**, **America/Santiago**, UTC-4). 3 campañas: `120246877650170097` OUTCOME_LEADS/PAUSED,
  `120246449950670097` OUTCOME_LEADS/ACTIVE, `120242921559350097` MESSAGES/ACTIVE. Insights agregados
  (`date_preset=maximum` → 2023-07-31 … 2026-08-16): impressions 1697 · reach 1216 · frequency 1.3956 ·
  clicks 58 · spend 9741 CLP · cpc 167.95 CLP · cpm 5740.13 CLP · ctr 3.4178. `ads_read` Standard PASS,
  **sin App Review / Business Verification / Advanced Access** para la prueba de desarrollo.
- **NOT_TESTED:** ADS_WRITE · LEAD_RETRIEVAL · actions (leads/messages/conversions).
- **NO INFERIDO (guardas):** `status/effective_status = ACTIVE` **╪** entrega (`deliveryState = NOT_OBSERVED`);
  `objective = OUTCOME_LEADS` **╪** capacidad de retrieval de leads ni PII; **business field ausente ╪**
  ownership personal (`businessRelationship = NO_BUSINESS_FIELD`); `maximum` **╪** "últimos 90 días"
  (se guarda provenance); la restricción del portfolio NO impidió las **lecturas** probadas, pero **no**
  se generaliza a entrega/writes/publishing/CAPI/lead retrieval.
- **Dinero:** todo importe transporta moneda (`{amount, currency}`); imposible mezclar CLP con USD.
- **Seguridad:** las respuestas de `/campaigns` y `/insights` pasan por el MISMO sanitizador central
  (`meta-organic.ts`): `access_token`/`appsecret_proof` redactados, `paging.next/previous` descartados.
  `RAW_GRAPH_RESPONSE_PERSISTENCE = FORBIDDEN`.
- **Frontera:** `ADS_READ_CAPABILITY = AVAILABLE` ╪ `ORGANIZATION_CONNECTION_STATUS = NOT_CONNECTED` ╪
  `PRODUCTION_AUTHORIZATION = NOT_GRANTED`. `ADS_WRITE_ADAPTER = LOCKED`, `AUTONOMOUS_REAL = false`.

`READ_FOUNDATION = RECOVER_EXISTING_APP` · `ADS_FOUNDATION = RECOVER_EXISTING` (lectura; entrega/writes
siguen restringidas). Contratos en `apps/api/src/acquisition/meta-ads.ts`; tests en
`apps/api/test/acquisition-meta-ads.test.ts`.

## 9. PRODUCTION READ-ONLY ONBOARDING DESIGN (2026-08-16) — DESIGNED, NOT CONNECTED

Diseño (contratos + máquina de estados + tests); **NO se conecta nada**: `REAL_OAUTH_EXECUTED = NO`,
`REAL_TOKEN_CREATED = NO`, `META_GRAPH_CALLS_FROM_SOEC = 0`, `PRODUCTION_CONNECTION = NOT_CONNECTED`.

```
Organization → OAuth (state anti-CSRF) → callback → validar state (one-time, org autoritativa del state)
  → validar scopes vs allowlist → discover assets (por ID) → HUMAN BINDING (confirmación explícita)
  → credencial cifrada por REFERENCIA (SecretStore) → CONNECTED_READ_ONLY → sync inicial → health
```

Estados (`meta-onboarding.ts`): NOT_CONNECTED · OAUTH_PENDING · OAUTH_CALLBACK_RECEIVED · TOKEN_VALIDATING ·
SCOPES_INCOMPLETE · ASSETS_DISCOVERED · BINDING_PENDING · CONNECTED_READ_ONLY · DEGRADED · REAUTH_REQUIRED ·
REVOKED · DISCONNECTED. **Nunca** se salta a CONNECTED sin binding humano; el callback fail-closed no deja
un CONNECTED falso; `connectionStatus` ╪ `healthStatus`.

- **Scopes (`meta-oauth.ts`):** allowlist READ-ONLY (pages_show_list, business_management, instagram_basic,
  pages_read_engagement, instagram_manage_insights, ads_read). PROHIBIDOS: ads_management, leads_retrieval,
  instagram_content_publish/manage_*, pages_manage_*. Un scope inesperado/de escritura **NO** eleva
  capacidades — SOEC gobierna por su allowlist.
- **OAuth state:** ligado a (org, actor), one-time, expirable, nonce impredecible inyectado. La org
  **autoritativa es la del state**, no la del callback (previene org swapping / CSRF / replay).
- **Human binding gate:** descubrir ╪ vincular. Binding sólo por confirmación humana explícita, por **ID
  canónico** (nunca por nombre/admin/app/único-resultado). *SC Topografía* (`100558733139736`) no puede
  auto-vincularse a SmileFlow.
- **Credencial por REFERENCIA:** `CredencialMetaRef` con `secretRef` opaca (la resuelve el adapter vía
  `@soec/secretos`, nunca el dominio); **jamás** token en claro en DB/logs/audit/errores/frontend.
- **Capability negotiation:** desde scopes efectivos + bindings confirmados + salud; **nunca** una
  capacidad de escritura; sin conexión activa ⇒ ninguna capacidad (capability ╪ authorization).
- **Health / reauth / disconnect:** token expirado/revocado ⇒ REAUTH_REQUIRED **sin borrar bindings**;
  revocación es un estado, no un borrado de métricas históricas.
- **Graph read port:** `MetaGraphReadPort` sólo discover/read; **cero** métodos de escritura. Toda
  respuesta pasa por el sanitizador central (`meta-organic`) antes de log/persistencia.

`ADS_WRITE_ADAPTER = LOCKED` · `AUTONOMOUS_REAL = false`. Contratos: `meta-onboarding.ts`, `meta-oauth.ts`;
tests: `acquisition-meta-onboarding.test.ts`. **NEXT_GATE: autorización humana para implementar el OAuth
real + almacenamiento de secreto productivo (KMS/SecretStore prod).**

## 10. META READ-ONLY PRODUCTION IMPLEMENTATION (2026-08-16)

Implementación de los casos de uso + puertos + fakes (`meta-oauth-flow.ts`). **NADA ejecutado contra
Meta:** `REAL_OAUTH_EXECUTED = NO`, `REAL_TOKEN_CREATED = NO`, `META_GRAPH_CALLS_FROM_SOEC = 0`,
`PRODUCTION_CONNECTION = NOT_CONNECTED`.

- **IMPLEMENTED (con fakes en tests):** `iniciarConexionMeta` (state seguro + authorization URL con
  allowlist read-only), `procesarCallbackMeta` (valida+consume state atómico → exchange (fake) → valida
  scopes efectivos → `SecretWriter.almacenar` → metadata `secretRef` → discovery (fake) → BINDING_PENDING;
  **nunca CONNECTED**; fail-closed sin token en DB/audit), `confirmarBindingMeta` (exige activo descubierto
  + confirmación humana por ID canónico → CONNECTED_READ_ONLY + capacidades read-only), DTOs seguros,
  redacción de `Bearer` añadida al sanitizador central.
- **TESTED_WITH_FAKES:** matriz de seguridad (consumo atómico un-ganador, forged/expired/replay/cross-tenant,
  scope FORBIDDEN inesperado ⇒ SCOPES_INCOMPLETE sin persistir token, SecretWriter falla ⇒ NOT_CONNECTED sin
  token en metadata, token nunca en credencial/DTO, SC Topografía no vinculable a SmileFlow, activo no
  descubierto rechazado, binding idempotente, Bearer/access_token redaction).
- **NOT YET EXECUTED AGAINST META / REQUIRES HUMAN AUTHORIZATION:** OAuth real, token real, adapter HTTP a
  Meta, discovery real, sync real. Los adapters productivos son puertos inyectados (hoy fakes).

**`PRODUCTION_SECRET_BACKEND = MISSING`** — hallazgo FASE 10: `@soec/secretos` `SecretStore` es SÓLO de
resolución (`resolver`); NO existe backend de ESCRITURA de secretos (KMS/vault) y está prohibido improvisar
uno con clave embebida. El flujo persiste únicamente `secretRef`; el valor del token vive sólo dentro del
`SecretWriterPort`. **Antes de cualquier conexión real hay que decidir/implementar el backend seguro de
escritura de secretos.** Contratos: `meta-oauth-flow.ts`; tests: `acquisition-meta-oauth-flow.test.ts`.

## 11. META SECRET STORAGE PRODUCTION (2026-08-16)

Auditoría del runtime (FASE 1): SOEC corre sobre **PostgreSQL** (docker-compose; sin KMS/vault cloud). Los
adaptadores de `@soec/secretos` existentes son **resolve-only**: `env:` (lectura en deploy), `file:`
(depósito de archivos en claro — inadecuado para escribir tokens), `en-memoria` (test). **No hay backend
de ESCRITURA de secretos aprobado.**

**SELECTED_BACKEND = Envelope encryption (AES-256-GCM) + KMS** (opción D). `WHY`: es la única opción segura
compatible con el stack actual sin introducir un secreto en claro; el ciphertext vive en PG (permitido),
la master key vive en un **KMS real** detrás del puerto `KmsPort` (nunca en repo/DB). Implementado en
`apps/api/src/acquisition/meta-secret-backend.ts`:

- `WRITE_SUPPORTED / READ_SUPPORTED / DELETE_SUPPORTED = YES` (`EnvelopeSecretBackend` implementa a la vez
  `SecretWriterPort` y el `SecretStore` de `@soec/secretos` → simetría write/resolve sobre el mismo KMS+store).
- `ROTATION_MODEL` = re-store (nueva data key por secreto) + `revocar`; reauth reemplaza la referencia.
- `TENANT_ISOLATION` = el `secretRef` codifica la org y el resolver verifica `ctx.org === ref.org === blob.org`.
- `ATOMIC_COMPENSATION` = el calles (`procesarCallbackMeta`) ya es fail-closed; `revocar` permite compensar
  si la transacción de DB falla tras el store.
- `PRODUCTION_FAKE_FORBIDDEN` = `assertBackendSeguroEnProduccion(NODE_ENV, backend)` lanza si en `production`
  el backend no es productivo (`KmsFake.esProductivo = false`).
- `SECRET_REF_CONTAINS_SECRET = NO` (`secretstore:<org>/<name>`); `APP_SECRET_MODEL` = mismo backend/KMS.
- `KNOWN_LIMITATIONS`: falta el **adapter real de `KmsPort`** (AWS/GCP KMS u otro) y su provisioning (key,
  credenciales, permisos cloud, posible billing) — eso es un gate humano/infra. El `KmsFake` es SÓLO test.

**IMPLEMENTED / TESTED_WITH_SYNTHETIC_SECRETS:** write→resolve→delete round-trip, tenant isolation,
ref forjada/malformada, ciphertext≠plaintext, GCM tamper detection, gate de producción, redacción de
`code` OAuth. **REAL_BACKEND_SMOKE = NOT_EXECUTED** (requiere provisionar el KMS real). `REAL_META_TOKEN_USED = NO`.

**`PRODUCTION_SECRET_BACKEND = IMPLEMENTED_NOT_VERIFIED`** — lógica de backend implementada y probada con
secretos sintéticos + KMS fake; falta el adapter `KmsPort` productivo + su provisioning para poder validar
contra el KMS real. Tests: `acquisition-meta-secret-backend.test.ts`.

## 12. VAULT TRANSIT KMS ADAPTER (2026-08-16) — IMPLEMENTED, NOT PROVISIONED

Decisión autorizada del runtime productivo: **HCP Vault Dedicated + Transit Secrets Engine** como KMS del
`KmsPort`. Railway (u otro PaaS) NO se usa como almacén dinámico de tokens OAuth — sólo podrá guardar la
config/credencial mínima para que el runtime autentique contra Vault (mecanismo a definir en provisioning).

`SELECTED_BACKEND = HCP_VAULT_DEDICATED_TRANSIT`. **Transit es cryptography-as-a-service, NO un secret
store**: cifra/descifra pero el ciphertext lo persiste la app. Por eso el adapter NO reescribe el diseño
envelope — sólo implementa el `KmsPort` (wrap/unwrap de la data key) que ya consume `EnvelopeSecretBackend`:

```
token OAuth efímero → AES-256-GCM local con DATA KEY → ciphertext persistido tenant-scoped en SOEC (PG)
DATA KEY → Transit encrypt (wrap) → vault:vN:… guardado como wrappedDataKey
resolver: wrappedDataKey → Transit decrypt (unwrap) → DATA KEY → descifrado local → token → uso → descarte
```

Implementado en `apps/api/src/acquisition/meta-vault-transit.ts`:

- `VAULT_TRANSIT_ADAPTER = IMPLEMENTED` (`VaultTransitKmsPort implements KmsPort, KmsRewrapCapable`);
  `wrapDataKey`=`/v1/<mount>/encrypt/<key>`, `unwrapDataKey`=`/decrypt`, `salud`=`/v1/sys/health`.
- `VAULT_HTTP_TRANSPORT = IMPLEMENTED` (`TransporteHttpVault`: `fetch` + `AbortController` timeout;
  `esProductivo = true`). `FAKE_TRANSPORT = IMPLEMENTED` (`FakeTransporteVault`, fiel al contrato, AES-GCM
  con master key en memoria SÓLO test, `esProductivo = false`).
- `MASTER_KEY_LOCATION = Vault` (Transit nunca la exporta). `HOMEMADE_CRYPTO = NO` (APIs oficiales de Transit).
- `META_TOKEN_SENT_TO_VAULT = NO` — sólo la data key viaja a `encrypt`/`decrypt`; test lo verifica sobre las
  peticiones capturadas.
- `AUTH_MODEL` = puerto `VaultAuthProvider` (hoy `VaultTokenEstaticoAuth`, token **inyectado** no hardcodeado;
  AppRole/JWT posible sin cambiar la API). El modelo definitivo se decide en el provisioning real.
- `CONFIG` (todo externo, nada hardcodeado): `VAULT_ADDR`, `VAULT_NAMESPACE?`, `VAULT_TRANSIT_MOUNT`,
  `VAULT_TRANSIT_KEY`, timeout; `validarConfigVault` falla-cerrado si falta algo.
- `FAIL_CLOSED`: timeout; jamás loggea plaintext/token/ciphertext; sin plaintext en excepciones; sanitizer
  central en los mensajes de error; valida el prefijo `vault:vN:` antes de la red; distingue
  `VaultNoDisponibleError` (5xx/429/timeout/red) de `VaultDescifradoError` (400 en decrypt) y de
  `VaultAutenticacionError` (401/403) / `VaultConfiguracionError` (404/config) / `VaultRespuestaInvalidaError`
  (body malformado). `KEY_ROTATION/REWRAP` soportado por contrato (`reenvolverDataKey` = `/rewrap/<key>`),
  **no ejecutado** en el flujo.

`TESTED_WITH_SYNTHETIC_SECRETS` (`acquisition-meta-vault-transit.test.ts`, 16): wrap/unwrap round-trip,
end-to-end con `EnvelopeSecretBackend`, token Meta nunca enviado a Vault, forwarding de token/namespace,
indisponible vs. descifrado vs. auth/config/malformado, rechazo pre-red de ciphertext malformado, rewrap
round-trip, mapeo de salud, gate de producción (fake ⇒ no productivo), sanitización de errores.

`REAL_VAULT_PROVISIONED = NO` · `REAL_VAULT_CREDENTIALS = NO` · `REAL_BACKEND_SMOKE = NOT_RUN` ·
`REAL_META_TOKEN_USED = NO`. **`PRODUCTION_SECRET_BACKEND = IMPLEMENTED_NOT_VERIFIED`.** No se marca READY
hasta que exista un HCP Vault real y pase: synthetic store/encrypt → persistence → resolve/decrypt →
compare → delete/cleanup contra infraestructura real.

**Smoke de runtime (one-shot, repo-only):** `pnpm -C apps/api vault:smoke` (o `pnpm vault:smoke`). Se
ejecuta DENTRO del runtime real de SOEC, donde la credencial de Vault está inyectada de forma segura; lee la
config sólo de `process.env` (`VAULT_ADDR`/`VAULT_NAMESPACE?`/`VAULT_TRANSIT_MOUNT`/`VAULT_TRANSIT_KEY` +
`VAULT_TOKEN`), arma el adapter PRODUCTIVO (`TransporteHttpVault`, nunca el fake) y corre health → round-trip
con secreto **sintético** (`randomBytes`) → cross-tenant reject → cleanup garantizado (`finally`). Emite sólo
un bloque estéril `=== SOEC VAULT RUNTIME SMOKE ===` (enums, cero valores); exit 0 = READY, 2 = config
ausente, 3 = adapter no productivo, 1 = fallo. `apps/api/src/acquisition/vault-smoke.ts` (núcleo testeable) +
`vault-smoke.cli.ts` (wiring env + safety gate). Sólo si este smoke da READY se declara
`PRODUCTION_SECRET_BACKEND = READY`. Tests: `acquisition-vault-smoke.test.ts` (9).

## Referencias

- Vault Transit Secrets Engine (encrypt/decrypt/rewrap; app persiste el ciphertext) — developer.hashicorp.com/vault/docs/secrets/transit
- HCP Vault Dedicated (namespaces, `X-Vault-Namespace`) — developer.hashicorp.com/hcp/docs/vault
- Vault `/sys/health` status codes — developer.hashicorp.com/vault/api-docs/system/health
- Graph API changelog / versiones — developers.facebook.com/docs/graph-api/changelog
- Instagram Platform · overview / content publishing — developers.facebook.com/docs/instagram-platform/
- Lead Ads (leads_retrieval, App Review) — developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads
- Business Verification / App Review (2026, ~20 días) — bundle.social/blog/meta-app-review-20-days
- Marketing API Q2-2026 update — kitchn.io/blog/meta-marketing-api-q2-2026-update
