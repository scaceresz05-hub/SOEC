# Autenticación, roles y modos operativos (Macrobloque 1)

Complementa `POSTURA_SEGURIDAD_PILOTO_V1.md` y `ADR-005`. Describe la fundación de identidad y
autorización multi-tenant que reemplaza el acceso abierto por URL.

## Principio central

**La ausencia de sesión NUNCA es autorización.** Regla productiva por defecto:
`sin sesión → 401 UNAUTHENTICATED`. Tres conceptos separados:

- **Autenticación** — quién es el usuario (sesión válida por cookie httpOnly).
- **Autorización** — a qué organización/recursos accede (membresía activa + permisos efectivos).
  La organización se resuelve por `slug` y se valida contra la membresía; **el `:org` de la URL
  nunca autoriza** (si no hay membresía activa → 404, sin revelar existencia).
- **Modo operativo** — qué acciones puede ejecutar una organización YA autorizada.

## Flags de seguridad (defaults seguros)

| Variable | Default | Producción |
|---|---|---|
| `SOEC_AUTH_REQUIRED` | `true` | obligatorio `true` (arranque falla si no) |
| `SOEC_LEGACY_DEMO_ACCESS_ENABLED` | `false` | **prohibido** (arranque falla si `true`) |

La **demo legacy** (rutas `/experience/*` sin auth) solo se re-registra en test/dev/demo cuando el
flag está activo; muestra una advertencia al iniciar; no da acceso a organizaciones reales; **no es
un fallback por-handler** (registro de rutas separado). Documentada como compatibilidad temporal.

## Sesiones

Token opaco (32 bytes, `base64url`); en PostgreSQL se guarda solo su **hash SHA-256**. Cookie
`httpOnly`, `SameSite=Lax`, `Secure` en producción, `Max-Age` (7 días). Revocables (individual y
todas). Al cambiar la contraseña se revocan todas las sesiones. Nunca en `localStorage` ni en URL.

- **Rotación en login:** al iniciar sesión se **revoca la sesión presentada** (si la hubiera) antes
  de emitir la nueva; nunca coexiste una credencial anterior con la recién emitida.
- **Revocación por suspensión:** suspender o revocar una membresía **revoca las sesiones** del
  usuario afectado (defensa en profundidad). La garantía primaria es el chequeo EN VIVO de membresía
  activa en cada request (bloqueo inmediato per-org). Nota honesta: las sesiones son a nivel de
  usuario (no por organización), por lo que la revocación también cierra sesiones del mismo usuario
  en otras organizaciones; se prefiere el corte explícito.

## Restablecimiento de contraseña

Token de **un solo uso**, hasheado (SHA-256), con vencimiento (30 min); un solo reset vigente por
usuario. Al confirmar: fija la nueva contraseña, marca el token usado y **revoca todas las sesiones**.
Respuesta uniforme en la solicitud (no enumera cuentas). El **canal de entrega (correo) es una
integración futura**; hoy el token se transporta fuera de banda y, solo fuera de producción, se
expone como `devToken` para pruebas. Nunca se registra el token en auditoría ni logs.

## Rate limiting

Limitador de intentos en memoria, configurable (`SOEC_RL_*`), con dos capas:
- **Específica por `(email, IP)`** en login: 5/15 min → bloqueo 15 min (fuerza bruta contra una cuenta).
- **Agregada por `IP`** en login y registro: 30/15 min → bloqueo 15 min (**frena password spraying**:
  una contraseña contra muchos correos desde una misma IP).
- **Reset por `IP`**: 5/15 min.

Todas responden **429** con `Retry-After`. `X-Forwarded-For` **no** se confía (no hay `trustProxy`):
`req.ip` es la IP del socket. Alcance declarado: el estado vive en el proceso — efectivo en un
despliegue de **una instancia**; multi-instancia requerirá un backend compartido (Redis), integración
futura. No sustituye WAF ni protección de red.

## Cabeceras de seguridad

Todas las respuestas: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: no-referrer`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none';
base-uri 'none'` (la API sirve JSON). `Strict-Transport-Security` solo cuando las cookies son
`Secure` (producción tras TLS).

## Cutover de la superficie vertical (auth obligatoria)

En condiciones normales (hay `pool` y la demo legacy está deshabilitada) TODA la superficie
vertical/experiencia se registra dentro de un **gateway autenticado**: sin sesión ⇒ **401**; sin
membresía activa en la organización indicada (`x-organization-slug`) ⇒ **404**. El gateway inyecta
contexto **autoritativo** server-side (`x-organization-id` = slug de la membresía, `x-actor-id` =
usuario de la sesión, `x-scope` = alcance del rol) y descarta lo que envíe el cliente para esas
cabeceras. La confianza-en-cabeceras SIN autenticar existe únicamente bajo el flag legacy en
test/dev. Residual declarado: las experiencias con contexto sintético server-side quedan
autenticadas (sesión + membresía) pero siguen operando sobre datos de demostración; su vinculación
tenant-a-tenant por experiencia es trabajo posterior.

## Contraseñas

`scrypt` (node:crypto, memory-hard; alternativa justificada a Argon2id para evitar dependencia
nativa). Sal aleatoria por contraseña (16 bytes), comparación en tiempo constante (`timingSafeEqual`).
Nunca texto plano ni cifrado reversible; nunca se registra la contraseña ni el hash.

- **Parámetros (v2):** `N=2^17 (131072)`, `r=8`, `p=1`, `keylen=64` — piso OWASP vigente para scrypt
  (≈0,2 s por operación). `maxmem` se eleva a 256 MB porque scrypt requiere ≈128·N·r bytes (~128 MB).
- **Formato versionado:** `scrypt$v2$N$r$p$saltHex$hashHex`. Se mantiene **compatibilidad de
  verificación** con hashes `v1` antiguos (`scrypt$N$r$p$salt$hash`, `N=2^14`). Tras un login correcto
  con un hash desactualizado se hace **rehash oportunista** a v2 (best-effort; nunca bloquea el login).
- **Límites de longitud:** mínimo 8, **máximo 128** caracteres, validados ANTES de derivar (evita DoS
  de CPU por entradas enormes). Aplica a registro, cambio, confirmación de reset y bootstrap. Toda
  contraseña inválida produce `EntradaInvalidaError → 400` (nunca 500) de forma uniforme.

## Política de login (anti-enumeración)

Respuesta y código genéricos (`401 credenciales inválidas`) para: usuario inexistente, contraseña
incorrecta y cuenta inactiva. El login ejecuta **siempre** una verificación scrypt — contra el hash
real o contra un **hash señuelo estable** cuando el usuario no existe/está inactivo — para no revelar
por temporización si un correo está registrado. No se registra el correo intentado ni la contraseña.

## Protección CSRF

Defensa en profundidad además de `SameSite=Lax`. Un hook global valida, en métodos **mutativos**
(POST/PUT/PATCH/DELETE), el `Origin` (o el `Referer` en su defecto) contra una **allowlist explícita**
(`SOEC_ALLOWED_ORIGINS`). Reglas: origen permitido → continúa; origen ajeno → **403**; sin Origin ni
Referer → continúa (cliente no-navegador: server-to-server, tests). Los métodos seguros (GET/HEAD) no
se filtran. El origen permitido **jamás** se deriva del request (no se confía en `Host`/`X-Forwarded-Host`),
no hay comodines, y la protección es global (cubre `/auth`, `/organizations` y `/experience`). En
**producción la allowlist es obligatoria** (el arranque falla si está vacía).

## Roles y permisos

Roles: `OWNER, ADMIN, MARKETING_MANAGER, MARKETING_OPERATOR, ANALYST, VIEWER`. La autorización
consulta **permisos efectivos** (nunca compara strings de rol dispersos). Resumen:

| Rol | Alcance |
|---|---|
| OWNER | todo, incl. `operational_mode.manage` y gestión de miembros |
| ADMIN | como OWNER salvo cambiar modo operativo |
| MARKETING_MANAGER | gestiona negocio/programas/campañas/contenido, aprueba, presupuesto, ejecución |
| MARKETING_OPERATOR | gestiona programas/campañas, revisa contenido; **no** aprueba ni administra miembros |
| ANALYST | lectura + `audit.read` |
| VIEWER | solo lectura |

Nadie puede modificar/suspender/revocar a un OWNER.

## Modos operativos

- **PILOT** (habilitado): usuario autenticado, org autorizada, datos controlados, canales
  deshabilitados, resultados/ROI simulados, sin gasto. **PILOT no significa público ni sin auth.**
- **SUPERVISED_REAL** (habilitable): estrategia/campañas/contenidos reales en borrador, datos
  internos autorizados, aprobación humana obligatoria; sin publicación/envío/gasto/mutación externa.
- **AUTONOMOUS_REAL**: **BLOQUEADO por dominio** (`NOT_AVAILABLE`); la API/dominio rechazan su
  activación (409) incluso para OWNER. No basta ocultarlo en la UI.

## Bootstrap

Idempotente y env-gated (`SOEC_BOOTSTRAP_ENABLED=true` + `SOEC_BOOTSTRAP_OWNER_EMAIL/PASSWORD/
ORG_SLUG/ORG_NAME`). Crea (sin sobrescribir) el owner y su organización en modo PILOT, registra
auditoría. Nunca credenciales hardcodeadas ni commiteadas.

## Auditoría

Tabla `identity_audit_events` (append-only a nivel de aplicación), acotada por organización,
paginada, sin secretos. Registra login (éxito/fallo), logout/revocación, creación/actualización de
organización, cambio de modo, invitaciones/aceptaciones/cambios de rol/suspensión/revocación, y
bootstrap. Incluye intentos sensibles rechazados relevantes.

## Fuera de alcance (macrobloques futuros)

Vinculación tenant-a-tenant de cada experiencia de contexto sintético (la SEGURIDAD ya exige sesión +
membresía; falta ligar cada experiencia a los datos reales del tenant); entrega de correo real para
invitaciones y reset; rate limiting con backend compartido (Redis) para multi-instancia;
publicación/envío/gasto real; canales externos; autonomía real; atribución de ROI financiero real.
