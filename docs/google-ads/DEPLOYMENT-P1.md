# Google Ads REAL en producción — Plan de despliegue (P1)

Provider Google Ads OAuth multi-tenant, READ ONLY, autónomo del PC local. Construido DORMIDO: hasta que se
carguen los secretos + se configure Google Cloud, la composición es `null` (fail-closed) y las rutas responden
`GOOGLE_ADS_NOT_CONFIGURED`. Meta permanece congelado (no se tocó ningún módulo `meta-*`).

## Resolución de credenciales (elimina el `GOOGLE_ADS_REFRESH_TOKEN` global)

```
organizationId → google_ads_connection (DB, tenant-scoped) → refresh token CIFRADO (envelope + AWS KMS)
  → decrypt server-side (boundary) → Google OAuth (access token efímero) → Google Ads API (searchStream, READ ONLY)
```

- **APP_LEVEL (global, env):** `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`.
- **TENANT_LEVEL (DB, por conexión):** refresh token (cifrado), customerId, loginCustomerId, timezone/moneda, estado.

## Migraciones (idempotentes, al boot de soec-api)

`googleAdsOAuthMigrations` → `0001_google_ads_oauth_init` crea (todas `organization_id`-scoped):
`google_ads_oauth_state`, `google_ads_credential`, `google_ads_connection`, `google_ads_ciphertext`.
Aisladas de las tablas `meta_*` ⇒ rollback independiente.

## Servicios a desplegar (CLI upload; NO hay auto-deploy)

- **soec-api** — migraciones + rutas OAuth (autenticadas + callback público) + scheduler DORMIDO.
- **soec-web** — proxy `/api/google-ads/*` + panel de conexión en `/negocios`.

## Scheduler

In-proceso (`GoogleAdsScheduler`, `setInterval`, `.unref()`), NO Windows Task. Aísla fallos por tenant
(un OAuth roto marca esa conexión NEEDS_REAUTH y NO detiene a las demás). **Dormido** salvo
`GOOGLE_ADS_SCHEDULER_ENABLED=true`. Dejar sin setear en el primer deploy.

## Gate humano (acciones externas, en orden)

1. **Google Cloud Console** (OAuth client existente):
   - Authorized redirect URI (producción): `https://<soec-api-prod>/acquisition/google-ads/oauth/callback`
   - OAuth consent screen: scope `https://www.googleapis.com/auth/adwords`; estado de publicación correcto.
   - Developer token con acceso a las cuentas objetivo (nivel correcto en el MCC).
2. **Railway → soec-api** (variables app-level; KMS ya presente):
   - `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_DEVELOPER_TOKEN`,
     `GOOGLE_ADS_OAUTH_REDIRECT_URI` (= exactamente la URI del punto 1).
   - El refresh token NO se carga como env: entra cifrado por-tenant vía el OAuth-desde-UI.

## Secuencia de despliegue

1. Deploy soec-api (corre migraciones al boot; composición se activa al detectar las 4 vars + KMS).
2. Deploy soec-web.
3. Smoke read-only: `GET /acquisition/google-ads/connection` (org de prueba) ⇒ `{ configurado: true, conexion.estado: NOT_CONNECTED }`.
4. Migrar SmileFlow por UI: `/negocios` → **Conectar Google Ads** → login Google → elegir cuenta → CONNECTED.
   (NO copiar la DB/token local.)
5. **Actualizar ahora** ⇒ verifica ingesta real read-only; `datos.dataThrough` refleja la fecha real.
6. (Opcional, más tarde) `GOOGLE_ADS_SCHEDULER_ENABLED=true` para sincronización desatendida.

## Rollback

- Código: redeploy del build anterior (CLI). Las tablas `google_ads_*` quedan inertes (no las usa el código viejo).
- Scheduler: `GOOGLE_ADS_SCHEDULER_ENABLED=false` (o unset) lo apaga sin redeploy de lógica.
- Desconexión de un tenant: `POST /acquisition/google-ads/disconnect` (revoca en Google + borra el envelope; el
  histórico del event store se conserva).
- Cero impacto en Meta (módulos `meta-*` intactos; migraciones/tablas separadas).

## READ ONLY (garantías)

`GOOGLE_ADS_WRITE_ACTIONS = 0` · `REAL_AD_SPEND = 0`. No existe `GoogleAdsWritePort` ni endpoints de
create/update/pause/budget/bid. El único acceso a la API es `googleAds:searchStream` +
`customers:listAccessibleCustomers`, bajo allowlist de host default-deny.
