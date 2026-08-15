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

## Referencias

- Graph API changelog / versiones — developers.facebook.com/docs/graph-api/changelog
- Instagram Platform · overview / content publishing — developers.facebook.com/docs/instagram-platform/
- Lead Ads (leads_retrieval, App Review) — developers.facebook.com/documentation/ads-commerce/marketing-api/guides/lead-ads
- Business Verification / App Review (2026, ~20 días) — bundle.social/blog/meta-app-review-20-days
- Marketing API Q2-2026 update — kitchn.io/blog/meta-marketing-api-q2-2026-update
