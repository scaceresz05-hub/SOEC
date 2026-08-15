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

## Referencias

- Graph API changelog / versiones — developers.facebook.com/docs/graph-api/changelog
- Instagram Platform · Content Publishing — developers.facebook.com/docs/instagram-platform/content-publishing/
- Marketing API Q2-2026 update (sunsets/webhooks) — kitchn.io/blog/meta-marketing-api-q2-2026-update
- Graph API v26.0 (placements) — unalsoft.com/blog/2026-07-31-meta-graph-api-v26
