# SOEC — Runtime de producción en Railway

Procedimiento canónico para desplegar SOEC en Railway. **Sin valores secretos en este documento.**

## Invariante de aislamiento (obligatorio)

```
SOEC runtime  !=  SSR Control runtime  !=  SmileFlow runtime
```

SOEC usa un **proyecto Railway propio y una base de datos propia**. Está PROHIBIDO reutilizar o referenciar,
en la config productiva de SOEC:

- `disciplined-spontaneity` (SSR Control — servicios `@ssr-control/*`, Postgres en `:5433`);
- `carefree-success` / `smileflow-staging` (SmileFlow — `smileflow-clinic`);
- cualquier `@ssr-control/*` o `smileflow-clinic`.

El Postgres local de SOEC vive en `:5544` (aislado del `:5433` de SSR Control) — ver `infrastructure/docker-compose.yml`.

## Modelo de servicios (proyecto `SOEC` / entorno `production`)

| Servicio    | Build                                            | Start                    | Healthcheck |
|-------------|--------------------------------------------------|--------------------------|-------------|
| `soec-api`  | `corepack pnpm@9.15.4 install --frozen-lockfile && pnpm -C apps/api build` | `pnpm -C apps/api start` (`node dist/server.js`) | `GET /health` → `{ "status": "ok" }` |
| `soec-web`  | `corepack pnpm@9.15.4 install --frozen-lockfile && pnpm -C apps/web build` | `pnpm -C apps/web start` (`next start`, respeta `PORT`) | — |
| `Postgres`  | (servicio gestionado de Railway)                 | —                        | —           |

- **Monorepo pnpm** (Node 24, ver `.nvmrc`). Root directory de cada servicio = raíz del repo.
- **`soec-api` es COMPILADO**: `pnpm -C apps/api build` empaqueta con esbuild el grafo primer-party
  (`server.ts` + `@soec/*` fuente) en `apps/api/dist/server.js`; `start` corre `node dist/server.js`.
  **No se usa `tsx` como proceso productivo.** (`tsx` queda para `dev`, tests y migraciones de release.)
- **`soec-web`**: Next.js; `start` = `next start`, que respeta `process.env.PORT` (Railway lo inyecta). Sin puerto fijo.
- **`soec-api`** escucha `host 0.0.0.0`, `port = process.env.PORT ?? 3000` (fallback sólo dev).

## Contrato de variables de entorno

> **CONFIG** = no secreta · **SECRET** = provista por el mecanismo seguro de Railway. Nunca se commitea un `.env` productivo.

### `soec-api`
| Variable | Clase | Nota |
|----------|-------|------|
| `NODE_ENV=production` | CONFIG | activa la postura de seguridad (auth obligatoria, CSRF) |
| `PORT` | CONFIG | inyectado por Railway |
| `SOEC_ALLOWED_ORIGINS` | CONFIG | origen(es) del `soec-web`, coma-separados; en producción DEBE ser no vacío |
| `SOEC_AUTH_REQUIRED=true` | CONFIG | obligatorio en producción (el arranque falla si es false) |
| `DATABASE_URL` | SECRET | Postgres PROPIO de SOEC (nunca el de SSR Control/SmileFlow) |
| secreto de sesión/JWT (`@soec/identity`) | SECRET | según config de identidad |
| `VAULT_ADDR` | CONFIG | endpoint HCP Vault |
| `VAULT_NAMESPACE` | CONFIG | opcional (HCP suele requerirlo) |
| `VAULT_TRANSIT_MOUNT` | CONFIG | p. ej. `transit` |
| `VAULT_TRANSIT_KEY` | CONFIG | clave Transit de SOEC |
| `VAULT_TOKEN` | SECRET | credencial de auth del runtime contra Vault |

### `soec-web`
| Variable | Clase | Nota |
|----------|-------|------|
| `PORT` | CONFIG | inyectado por Railway |
| origen/URL del API | CONFIG | según la config del front |

## Estrategia de config-as-code

`RAILWAY_CONFIG_STRATEGY = config VERSIONADA por servicio`. **No** se usa un `railway.toml`/`railway.json` en la
raíz: en un monorepo con dos servicios que comparten root directory, un único archivo raíz sería ambiguo (ambos
servicios leerían el mismo build/start). En su lugar, cada servicio tiene su **propio archivo versionado** en la
raíz del repo, y apunta a él con su **Config Path** (Railway → servicio → Settings → "Railway Config File"):

| Servicio   | Archivo versionado   | Config Path a fijar en el servicio |
|------------|----------------------|------------------------------------|
| `soec-web` | `railway.web.toml`   | `railway.web.toml`                 |
| `soec-api` | `railway.api.toml`   | `railway.api.toml`                 |

Cada archivo declara `builder = "RAILPACK"`, `build.buildCommand` y `deploy.startCommand` (y `deploy.healthcheckPath`
en la API). El **Config Path es un ajuste de servicio** (dashboard): el CLI de Railway no lo fija (`railway up` no
acepta `--config`; no hay comando de config path). Fijarlo una sola vez por servicio.

**Antipatrón corregido (2026-08-17):** antes la config se creaba a mano como `railway.toml` y se borraba antes de
`railway up`; el snapshot subido quedaba sin config y Railpack abortaba en `prepare` con **"No start command
detected"** (los 8 deploys de `aacc693` quedaron FAILED). Versionar la config por servicio hace el deploy
reproducible y elimina ese paso manual.

## Migraciones

`MIGRATION_STRATEGY = paso de release con tooling de build (devDeps disponibles)`.

```
pnpm -C apps/api migrate:prod     # = tsx ../../packages/decision/src/pg/migrate-cli.ts
# (equivalente al `pnpm migrate` de la raíz)
```

Se ejecuta como paso de **release/deploy** (cuando las devDeps están presentes), no dentro del proceso API en
ejecución. La API productiva (`node dist/server.js`) no depende de `tsx` para arrancar.

## Runbook de despliegue (orden)

1. Crear el proyecto Railway **`SOEC`** (nuevo, separado de SSR Control y SmileFlow).
2. Agregar el servicio **Postgres** (DB propia de SOEC).
3. Crear **`soec-api`**; conectar el repo GitHub `scaceresz05-hub/SOEC`.
4. Crear **`soec-web`**; mismo repo.
5. Seleccionar la rama de deploy = **`main`** (fundación aprobada). **No** desplegar de forma permanente una
   rama experimental (p. ej. `feat/meta-read-only-onboarding`) como producción — ver «Fundación vs. rama Meta».
6. Configurar **build/start/healthcheck** de cada servicio (tabla de arriba).
7. Cargar variables **CONFIG** (no secretas).
8. Cargar **SECRETS** por el mecanismo seguro de Railway (incluida la config Vault + `VAULT_TOKEN`).
9. Fijar el **healthcheck** de `soec-api` en `/health`.
10. Ejecutar **migraciones** (`migrate:prod`) como paso de release.
11. **Deploy** desde `main`.
12. **Smoke de API/web**: `soec-api` responde `GET /health` = 200; `soec-web` sirve su superficie mínima.
13. **Vault runtime smoke**: `railway run pnpm -C apps/api vault:smoke` → exige
    `PRODUCTION_SECRET_BACKEND = READY` (round-trip sintético contra Vault Transit real; ver `docs/adquisicion/META-READ-ONLY-ONBOARDING.md` §12).
14. **Sólo entonces**, y en un gate aparte, el OAuth read-only real de Meta (SmileFlow only).

## Fundación vs. rama Meta

- `main` = fundación aprobada del runtime.
- El harness `vault:smoke` y el onboarding Meta viven hoy en `feat/meta-read-only-onboarding` (rama, sin push).
- El runtime base nace desde `main`. La integración de la rama Meta es un **gate específico posterior** (no en este bloque).
