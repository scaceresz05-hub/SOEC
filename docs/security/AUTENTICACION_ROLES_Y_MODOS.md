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

Limitador de intentos en memoria por identificador (login: email+IP; reset: IP): 5 intentos por
ventana de 15 min → bloqueo temporal de 15 min (**429** con `Retry-After`). Alcance declarado: el
estado vive en el proceso — efectivo en un despliegue de una instancia; multi-instancia requeriría un
backend compartido (Redis), integración futura. No sustituye WAF ni protección de red.

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
nativa). Sal aleatoria por contraseña (16 bytes), comparación en tiempo constante
(`timingSafeEqual`), formato versionado `scrypt$N$r$p$salt$hash`, mínimo 8 caracteres. Nunca texto
plano ni cifrado reversible; nunca se registra la contraseña ni el hash.

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
