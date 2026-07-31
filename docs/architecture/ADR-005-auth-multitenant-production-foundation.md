# ADR-005 — Fundación productiva segura: autenticación y multi-tenant

Estado: **PROPUESTA / EN IMPLEMENTACIÓN** (Macrobloque 1). Base: `main` (`67e254a`).

## Problema

SOEC opera hoy como piloto abierto: la capa `/experience/*` construye el contexto de organización
desde el `:org` de la URL, **sin autenticación**. Cualquiera que conozca un identificador puede
nombrarlo. Para uso interno real (SmileFlow como primer negocio) hace falta autenticación,
autorización multi-tenant, organizaciones/usuarios/membresías/roles/permisos, sesiones seguras,
auditoría y aislamiento transversal — sin romper el demo ni la suite existente.

## Decisiones

### D1 — Paquete de frontera `@soec/identity`
La identidad es un paquete propio (`packages/identity`), no lógica dispersa en `apps/api`. Capas:
`domain/` (entidades + invariantes + roles/permisos + modos), `application/` (casos de uso),
`pg/` (migraciones + repositorios relacionales), `errors/`.

### D2 — Persistencia RELACIONAL (no event-sourcing) para identidad
Identidad es naturalmente relacional (constraints, FKs, unicidad, transacciones). Se usan tablas
PostgreSQL vía el `Pool` existente (`makePool`) y el sistema de migraciones existente
(`runMigrations` + `identityMigrations` añadido a `migrate-cli`). El event-store (tabla `events`)
sigue siendo la SSOT operacional; identidad es un plano de control separado.

### D3 — Organización relacional = autoridad; `slug` = clave de tenant
La `Organization` relacional (uuid + `slug`) es la autoridad de autorización. El **`slug`** es la
clave de tenant que coincide con el `organizationId` (string) que ya usan los streams del
event-store (p. ej. `smileflow-clinic-pilot`). Así la autorización (sesión→membresía→organización)
resuelve un `slug` que luego acota las consultas al event-store. El registro event-sourced de
organizaciones piloto (`orgindice`) queda como dato de demostración; la autoridad pasa a ser la
tabla `organizations`.

### D4 — La URL `:org` NUNCA es fuente de autoridad
El `:org` sirve para localizar un recurso, pero la autorización proviene de:
`sesión válida → usuario → membresía ACTIVA → organización → permisos efectivos`. Si el `:org`
pedido no coincide con una membresía activa del usuario, se responde **404** (no revela existencia).

### D5 — Sin sesión ⇒ 401 (CORREGIDA). Tres conceptos separados.
**La ausencia de sesión NUNCA se convierte en autorización.** Regla productiva y por defecto:
`sin sesión → 401 UNAUTHENTICATED`. Se distinguen tres conceptos que no se mezclan:
- **Autenticación** — quién es el usuario (sesión válida).
- **Autorización** — a qué organización/recursos accede (membresía activa + permisos efectivos).
- **Modo operativo** — qué acciones puede ejecutar una organización YA autorizada (PILOT/…).

`PILOT` **no significa "público" ni "sin autenticación"**: significa usuario autenticado, org
autorizada, datos controlados, canales deshabilitados, resultados simulados, sin gasto real.

**Flags (defaults seguros):**
- `SOEC_AUTH_REQUIRED=true` (por defecto). En producción, obligatorio.
- `SOEC_LEGACY_DEMO_ACCESS_ENABLED=false` (por defecto). Compatibilidad histórica **solo** para
  tests/dev/demo controlada.

**Compatibilidad legacy (demo `/experience/*` sin auth):** conservada únicamente detrás de
`SOEC_LEGACY_DEMO_ACCESS_ENABLED`. Condiciones: default `false`; **prohibida en producción — el
arranque falla si se intenta habilitar en prod**; solo test/dev/demo; advertencia inequívoca al
iniciar; no da acceso a organizaciones reales; **no comparte rutas con el contexto autenticado
real (registro de rutas separado, no fallback por-handler)**; no se infiere por ausencia de cookie;
no es un fallback silencioso; documentada como temporal. Las rutas legacy `/experience/*` se
registran **solo** si el flag está activo.

**Rutas productivas** (`/auth/*` públicas mínimas + `/organizations/*` y toda ruta org-scoped):
**autenticación obligatoria** (401 sin sesión). Los tests se adaptan a esto (crean usuario+org+
membresía+sesión o activan explícitamente el flag legacy); la arquitectura segura no se debilita
para acomodar tests históricos.

### D6 — Sesiones por cookie httpOnly
Token opaco aleatorio (32 bytes); se almacena sólo su **hash SHA-256**; cookie `httpOnly`,
`SameSite=Lax`, `Secure` en producción; sesiones **revocables** (individual y todas), con
expiración y `lastSeenAt`. No se usan tokens en `localStorage`. CSRF: al usar `SameSite=Lax` +
métodos mutantes por POST con `content-type: application/json`, el riesgo CSRF clásico de
formularios cross-site queda mitigado; se evalúa un token CSRF explícito cuando haya orígenes web
de terceros (no en este bloque). No se usa JWT (se prioriza revocación inmediata).

### D7 — Hash de contraseñas: `scrypt` (node:crypto), alternativa justificada a Argon2id
Se usa `scrypt` (memory-hard, incorporado en `node:crypto`) con sal por contraseña (16 bytes) y
comparación en tiempo constante (`timingSafeEqual`). Justificación frente a Argon2id: evita una
dependencia nativa externa (riesgo de cadena de suministro / compilación) manteniendo una función
memory-hard reconocida por OWASP. Nunca cifrado reversible ni texto plano. Formato almacenado:
`scrypt$N$r$p$salt$hash`.

### D8 — Roles agrupan permisos; la autorización consulta PERMISOS EFECTIVOS
Roles base: `OWNER, ADMIN, MARKETING_MANAGER, MARKETING_OPERATOR, ANALYST, VIEWER`. Permisos
atómicos (`organization.manage`, `members.invite`, `program.manage`, `content.approve`,
`execution.approve`, `audit.read`, …). La autorización nunca compara strings de rol dispersos:
`requirePermission(permission)` resuelve el conjunto efectivo del rol de la membresía.

### D9 — Modos operativos con AUTONOMOUS_REAL bloqueado por dominio
`PILOT` (habilitado), `SUPERVISED_REAL` (habilitable, sin efectos externos aún: sin publicación,
envío, gasto ni mutación en plataformas), `AUTONOMOUS_REAL` (**NOT_AVAILABLE**: la API y el dominio
rechazan su activación; no basta ocultarlo en la UI).

### D10 — Auditoría append-only por organización
Tabla `audit_events` (append-only a nivel de aplicación), acotada por organización, paginada, sin
secretos ni tokens completos; registra actor, acción, recurso, resultado, timestamp; incluye
intentos sensibles rechazados relevantes (login fallido, acceso cruzado denegado) sin ruido.

## Consecuencias

- (+) Base real de auth/multi-tenant sin romper el demo ni la suite (backward-compat en PILOT).
- (+) La autoridad deja de venir de la URL cuando hay sesión; nuevas rutas siempre autenticadas.
- (−) Deuda declarada: la migración dura de TODAS las rutas `/experience/*` a auth obligatoria
  (y la reescritura de sus tests) queda para un incremento posterior. Documentado en la postura
  de seguridad. **AUTONOMOUS_REAL** y toda ejecución externa real permanecen fuera de alcance.
- (−) `scrypt` en vez de Argon2id (aceptable; revisable si se añade dependencia nativa).

## Fuera de alcance de este macrobloque
Meta/Google/LinkedIn/TikTok Ads, publicación/envío real, WhatsApp, pagos, gasto, ROI real,
scraping, adquisición de datos personales externos, conexión con producción SmileFlow.

## Incremento final (cierre de deudas del Macrobloque 1)

Tras la auditoría, se implementó el endurecimiento y el cutover que faltaban:

### D11 — Rotación de sesión y revocación por suspensión
Login revoca la sesión presentada antes de emitir la nueva. Suspender/revocar una membresía revoca
las sesiones del usuario (defensa en profundidad); la garantía primaria sigue siendo el chequeo EN
VIVO de membresía activa por request. Sesiones a nivel de usuario: la revocación es global al
usuario (tradeoff documentado).

### D12 — Restablecimiento de contraseña (núcleo)
Token de un solo uso, hasheado, con vencimiento; al confirmar revoca todas las sesiones. Respuesta
uniforme (no enumera). Canal de correo = integración futura; `devToken` solo fuera de producción.

### D13 — Rate limiting y cabeceras de seguridad
Limitador en memoria por identificador (login: email+IP; reset: IP): 5/15 min → bloqueo 15 min (429).
Cabeceras en todas las respuestas: `nosniff`, `DENY`, `no-referrer`, CSP restrictiva; HSTS solo con
cookies `Secure`. Alcance del limitador: por proceso (multi-instancia ⇒ Redis, futuro).

### D14 — Cutover de la superficie vertical a auth obligatoria (gateway)
En condiciones normales (hay `pool`, legacy off) TODA la superficie vertical/experiencia se registra
dentro de un **gateway autenticado**: sin sesión ⇒ 401; sin membresía en la organización indicada ⇒
404. El gateway inyecta contexto autoritativo server-side (`x-organization-id`/`x-actor-id`/`x-scope`
derivado del rol) y descarta lo que envíe el cliente. La confianza-en-cabeceras sin auth queda
únicamente bajo el flag legacy en test/dev. Residual: ligar cada experiencia sintética a los datos
reales del tenant (la seguridad ya está; la vinculación de datos es trabajo posterior).
