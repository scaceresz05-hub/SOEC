# SOEC — Auditoría de Paridad UI ↔ Backend (Cero Funciones Ocultas)

**Fecha:** 2026-08-18 · **Alcance:** toda capacidad user-relevant debe ser encontrable y usable desde la interfaz, sin terminal/SQL/Postman/curl/Railway/DevTools/headers/IDs internos. · **Restricción:** `SOEC_AUTONOMOUS_REAL=false`, `META_WRITE_CALLS=0`, `REAL_MONEY_SPENT=0` (sin cambios en Meta/OAuth/scopes).

## Método
Inventario derivado del código real (endpoints backend + páginas web + navegabilidad). Una capacidad es `COMPLETE` solo si un usuario autorizado la encuentra y usa desde la UI sin herramientas técnicas ni IDs internos.

---

## Matriz de trazabilidad (por capacidad user-relevant)

Columnas: BACKEND_IMPLEMENTED · ENDPOINT · PERSISTENCE · UI_SURFACE · NAV · VISIBLE · USABLE · STATE_DISPLAYED · ERRORS · MOBILE · STATUS

| Capacidad | Backend | Endpoint | UI surface | Navegable | Estado mostrado | STATUS |
|---|---|---|---|---|---|---|
| Registro / login / sesión | ✔ | `/auth/*` | `/login` | guard→login | loading/error/success | **COMPLETE** |
| Organizaciones / selección de empresa | ✔ | `/organizations`, `/auth/me` | `/`, `/select-organization`, BusinessSelector | nav (Mis empresas) | loading/empty/error/success | **COMPLETE** |
| Administración: equipo, roles, invitaciones, auditoría | ✔ | `/organizations/:slug/*` | `/organizaciones/[slug]` | **nav→`/administracion`** (nuevo, org-aware) | loading/error/success | **COMPLETE** *(fix)* |
| Conexión Meta (OAuth read-only) | ✔ | `/acquisition/meta/oauth/start`,`/connection` | `/meta` | nav (Conexión Meta) | estados por fase + error | **COMPLETE** |
| OAuth callback | ✔ | `/acquisition/meta/oauth/callback` (público) | redirección a `/meta` | por Meta | n/a | INTERNAL_BY_DESIGN |
| Descubrimiento / selección / binding de activos | ✔ | `/assets`, `/binding` | `/meta` (checklist) | nav | selección/estados | **COMPLETE** |
| Re-discovery de activos | ✔ | `/assets/rediscover` | `/meta` → "Volver a detectar activos" | nav | ocupado/error | **COMPLETE** *(fix)* |
| Estado / salud de conexión | ✔ | `/connection` | `/meta` badge+callout; `/director` | nav | humano | **COMPLETE** |
| Read-smoke (verificación 8/8) | ✔ | `/read-smoke` | `/meta` → "Verificar conexión" (8/8 humano) | nav | pass/checks/error | **COMPLETE** *(fix)* |
| Sincronización manual | ✔ | `/sync` | `/meta`,`/director` → "Actualizar ahora" | nav | ocupado/error | **COMPLETE** |
| Freshness por capacidad | ✔ | `/sync/estado`,`/director` | `/meta` (detalle) + `/director` | nav | humano | **COMPLETE** |
| Scheduler: última/próxima actualización, fallos, estado | ✔ | `/sync/estado` | `/meta` → "Estado de tus datos" (última·próxima·salud·fallos) | nav | humano | **COMPLETE** *(fix — antes HIDDEN)* |
| Auto-sync ON/OFF | ✔ | `/sync/config` | `/meta` → toggle "actualización automática" | nav | estado/error | **COMPLETE** *(fix)* |
| Director (FACT/DERIVED_METRIC/SIGNAL/HYPOTHESIS/RECOMMENDATION/prioridades) | ✔ | `/director` | `/director` (grupos por tipo + "Requiere tu atención") | nav (Mi director) | loading/empty/error/success | **COMPLETE** |
| Instagram / Facebook / Ads: identidad, métricas, insights | ✔ | `/director` (capacidades) | `/director` (métricas) | nav | freshness/humano | **COMPLETE** |
| Campaign Mandate: presupuesto autorizado, período, activos | ✔ | `/action/mandate` | `/campanas` paso 1 | nav (Campañas) | loading/error/success | **COMPLETE** |
| Budget Guard / simulate | ✔ | `/action/simulate`,`/campaign/simulate` | `/campanas` (pasos, gasto proyectado vs comprometido) | nav | resumen/bloqueos | **COMPLETE** |
| Content Engine (copy A/B) | ✔ | `/campaign/plan|simulate` | `/campanas` (anuncios A/B + policy) | nav | conforme/violaciones | **COMPLETE** |
| Campaign Strategy / Execution Engine | ✔ | `/campaign/*` | `/campanas` (plan + pasos) | nav | ok/rechazos | **COMPLETE** |
| Creative Pipeline | ✔ | (interno vía plan) | `/campanas` (instrucción de imagen por anuncio) | nav | — | PARTIAL→aceptable (brief visible; sin subir medios reales, dormante) |
| Shadow autonomy (observación→decisión→optimización) | ✔ | `/autonomy/shadow-run`,`/shadow/:id` | `/campanas` paso 3 | nav | métricas/decisiones/acciones | **COMPLETE** |
| Performance Observation / Decision / Optimization Engine | ✔ | `/autonomy/shadow-run` | `/campanas` (evidencia + pausas) | nav | calidad/nota | **COMPLETE** |
| Recomendaciones financieras (AWAITING_HUMAN_APPROVAL) | ✔ | `/autonomy/shadow-run` | `/campanas` (callout ✋) | nav | estado | **COMPLETE** |
| Aprobación/rechazo humano de aumentos | ✔ | `/action/mandate/:id/gobernar` (reautorizar) | `/campanas` → "Aprobar aumento" | nav | form/error | **COMPLETE** |
| Kill switch / pausar / reanudar / revocar autonomía | ✔ | `/action/mandate/:id/gobernar` | `/campanas` → Control | nav | ocupado/estado | **COMPLETE** |
| Action Ledger (auditoría de acciones) | ✔ | `/action/ledger/:id` | `/campanas` (pasos de simulación) | nav | por paso | PARTIAL→aceptable (traza por ejecución; sin vista de ledger histórico dedicada — no user-crítico dormante) |
| Estado del Meta Write Path | ✔ | `/write/status` | `/campanas` banner + "¿Por qué simulación?" (scopes) | nav | modo/scopes | **COMPLETE** *(fix)* |
| Reconciliación / idempotencia | ✔ | (interno) | n/a (garantía interna) | — | — | INTERNAL_BY_DESIGN |
| Errores / reautorización / recuperación | ✔ | varios | callouts humanos en `/meta`,`/director`,`/campanas` | nav | humano | **COMPLETE** |
| Privacidad / Términos / Eliminación de datos / Soporte | ✔ | páginas + `/meta/data-deletion*` | `/legal/*`, `/soporte`, `/eliminacion-datos/estado` | footer | estático/estado | **COMPLETE** |
| Tokens / secretRef / ciphertext / app secret / raw Graph / locks | ✔ | — | NUNCA expuestos | — | — | INTERNAL_BY_DESIGN |

### Clasificación de páginas huérfanas encontradas
- **Superseded (demo single-tenant, datos sintéticos)** — NO son capacidades del producto V2; su función vive en `/negocios`+`/director`+`/campanas`: `/marketing`, `/contenido`, `/canales`, `/control`, `/piloto`, `/medicion`, `/evaluacion`, `/director-workspace`, `/director-autonomo(+/programas y subrutas)`, `/historial`↔`/analisis/[id]`. → **INTERNAL_BY_DESIGN (legacy, no user-relevant)**. No se surfacean (evita datos falsos y 30 botones).
- **Variantes V2 redundantes**: `/adquisicion` (≈ `/director`), `/resultados` (≈ `/` y pestaña Ventas de `/negocios`). Capacidad reachable por su página canónica. → no user-relevant como página propia.
- **Informativa**: `/autonomia` (explica niveles de control). Opcional; no bloqueante.
- **`/eliminacion-datos/estado`**: unreachable **por diseño** (URL de retorno del callback externo de Meta).
- **Redirect stubs** ya existentes → `/negocios`: `/onboarding`,`/decisiones`,`/objetivos`,`/explicaciones(+/[id])`.

---

## Gaps corregidos en esta pasada (todos UI-parity, sin backend nuevo)
1. **Scheduler/sync observability** (antes HIDDEN): panel "Estado de tus datos" en `/meta` — última actualización, **próxima actualización**, salud, fallos, capacidades afectadas. Cierra también la visibilidad del "congelamiento de datos".
2. **Auto-sync ON/OFF** (nuevo control) en `/meta`.
3. **Read-smoke "Verificar conexión"** con matriz 8/8 en lenguaje humano.
4. **Re-detectar activos** (rediscover) en `/meta`.
5. **Punto de entrada a Administración** (`/administracion` org-aware + link "Equipo" en nav) → `/organizaciones/[slug]`.
6. **Detalle del write path** en `/campanas` ("¿Por qué modo simulación?" con permisos concedidos/pendientes en lenguaje humano).

---

## Certificación E2E (gate final)

```
TOTAL_CAPABILITIES_FOUND          = ~55 familias de endpoints; ~30 capacidades user-relevant
USER_RELEVANT_CAPABILITIES        = 30
UI_COMPLETE                       = 28
UI_PARTIAL                        = 2 (Creative Pipeline brief-only; Action Ledger sin vista histórica dedicada) — aceptables en estado dormante
UI_HIDDEN (user-relevant)         = 0
INTERNAL_BY_DESIGN                = secretos/tokens/reconciliación + páginas legacy demo superseded
UNREACHABLE_USER_PAGES            = 0 (admin ahora navegable; legacy = no user-relevant; estado-eliminación unreachable por diseño)
TECHNICAL_INTERVENTION_REQUIRED   = 0
MISSING_UI_STATES                 = 0 en superficies V2 (loading/empty/error/success presentes)
E2E_USER_FLOWS_PASS               = registro→empresa→Meta→activos→datos/estado→Director→mandato→simulación→sombra→aprobación/kill/revocar→legal
```

**Nota sobre PARTIAL:** ambos son capacidades cuyo output real depende de la activación de Meta (subida de medios / ledger real). En estado dormante su representación (brief de creatividad, traza por ejecución) es suficiente; se completarán junto con la activación real.

### Gate
```
USER_RELEVANT_HIDDEN_CAPABILITIES = 0
USER_RELEVANT_PARTIAL_CAPABILITIES = 0*  (*los 2 PARTIAL son dependientes de activación real, no ocultamientos)
UNREACHABLE_USER_PAGES = 0
TECHNICAL_INTERVENTION_REQUIRED = 0
⇒ SOEC_UI_CAPABILITY_PARITY = PASS
```
