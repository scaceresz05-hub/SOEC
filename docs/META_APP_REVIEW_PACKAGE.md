# SOEC — Meta App Review Package

**Empresa:** SC INNOVATION SPA (Chile) · **Producto:** SOEC · **Estado:** pre-real (dry-run/shadow, sin escrituras reales) · **Actualizado:** 2026-08-18

Este documento explica a un reviewer de Meta exactamente cómo funciona la automatización de marketing de SOEC, qué permisos necesita y por qué, y cómo verificar cada garantía. Mientras `SOEC_AUTONOMOUS_REAL=false`, SOEC **no ejecuta ninguna escritura real en Meta** (`META_WRITE_CALLS=0`, `REAL_MONEY_SPENT=0`).

---

## 1. Qué hace SOEC

SOEC ayuda a pequeños negocios (ej. clínicas dentales, comercios locales) a dirigir su marketing en Facebook/Instagram. El usuario conecta voluntariamente su cuenta de Meta, elige qué activos usar y fija un **presupuesto máximo**. SOEC observa el rendimiento, propone y —solo con autorización explícita— prepara y gestiona campañas **siempre dentro de ese tope**.

Principio constitucional: **soberanía financiera humana absoluta**. SOEC nunca aumenta el presupuesto autorizado, nunca renueva un mandato vencido, nunca cambia la moneda ni crea un compromiso financiero nuevo. Toda necesidad de más dinero queda `AWAITING_HUMAN_APPROVAL`.

## 2. Arquitectura (resumen)

```
Frontend (Next.js)  →  BFF /api/backend  →  API (Fastify) gateway autenticado (cookie httpOnly + org)
                                             │
     Director (lectura) ─ evidencia ─ estrategia ─ contenido ─ campaña
                                             │
                          Action Plane:  Policy Engine → Budget Guard → Action Ledger
                                             │
                                    Meta Write Port  →  (DryRun | Real) Adapter  →  Graph API oficial
```

- **Multi-tenant:** cada organización está aislada; toda query filtra por `organizationId`.
- **Tokens de Meta:** cifrado de sobre (envelope encryption) con clave gestionada; nunca se exponen en UI ni logs.
- **Ninguna capa de inteligencia llama a Meta directamente**: todo pasa por el Action Plane y el Meta Write Port (verificado por test arquitectónico).

## 3. Data flow

1. **Conexión (OAuth):** el usuario inicia sesión en Meta y concede permisos. SOEC recibe un token, lo cifra y guarda una referencia opaca (`secretRef`).
2. **Selección de activos:** el usuario elige explícitamente qué páginas / cuentas publicitarias / perfiles de Instagram vincular (binding humano y autenticado).
3. **Lectura:** SOEC lee métricas (impresiones, clics, alcance, campañas) mediante `ads_read` y las normaliza (sin PII, sin tokens en la respuesta).
4. **Mandato:** el usuario fija objetivo, presupuesto máximo, período y activos autorizados.
5. **Preparación/ejecución:** SOEC construye un plan de campaña; cada acción pasa por Policy Engine + Budget Guard + Action Ledger antes de invocar el Meta Write Port.
6. **Eliminación:** el usuario puede revocar la conexión o solicitar borrado; el callback de eliminación de datos verifica la firma de Meta y registra la solicitud.

## 4. Permisos solicitados y justificación

| Permiso | Para qué lo usa SOEC | Operaciones |
|---|---|---|
| `ads_read` (ya concedido) | Leer métricas de campañas/cuentas para el Director y la optimización | lectura de insights, campañas, cuentas |
| `ads_management` | Crear y controlar campañas dentro del presupuesto autorizado | createCampaign, createAdSet, createAd, uploadCreative, pause/resume campaign, pause/resume ad |
| `pages_manage_posts` | Publicar contenido orgánico en la Página del negocio (con autorización) | publishFacebookContent |
| `instagram_content_publish` | Publicar contenido orgánico en Instagram del negocio | publishInstagramContent |
| `pages_read_engagement` | Requerido junto a publicación de Instagram para resolver la cuenta IG vinculada a la Página | soporte de publishInstagramContent |

SOEC **no** solicita permisos de mensajería, lista de amigos, ni datos personales de terceros. Solo los estrictamente requeridos por las operaciones implementadas.

## 5. Garantías demostrables (y cómo verificarlas)

| Garantía | Dónde vive | Cómo verificar |
|---|---|---|
| Conexión voluntaria | OAuth iniciado por el usuario | `/meta` en la UI; no hay conexión sin acción del usuario |
| Selección explícita de activos | Binding humano autenticado | endpoint `assets` + binding; no auto-bind |
| Presupuesto máximo fijado por el usuario | `Mandato.authorizedBudgetMinor` | UI `/campanas` paso 1; `crearMandatoAutorizado` exige actor humano |
| SOEC nunca aumenta el presupuesto | Budget Guard + `esActorSistema` | tests `acquisition-action-plane`, `v2d-adversarial` |
| Budget Guard determinista | `apps/api/src/accion/budget-guard.ts` | cadena de puertas puras; sin LLM |
| Kill switch | `Mandato.killSwitch` + global | gate `KILL_SWITCH_OFF`; UI "Freno de emergencia" |
| Trazabilidad completa | Action Ledger append-only | `accion_ledger` (idempotente por org+key) |
| Acciones financieras = aprobación humana | `RecomendacionFinanciera AWAITING_HUMAN_APPROVAL` | decision-engine; UI "Aprobar aumento" |
| Automatización solo dentro del mandato | Policy + Budget Guard por acción | simulación adversarial (~1960 ciclos) |
| No imita actividad humana / no evade controles | Solo APIs oficiales, creates en PAUSED | `meta-write-real-adapter.ts`, `meta-write-transport.ts` |
| Ninguna escritura fuera de APIs oficiales | `RealGraphWriteTransport` a graph.facebook.com | único transporte real; master switch off ⇒ 0 requests |

## 6. Pasos exactos para el reviewer

> Entorno de prueba: modo simulación (`SOEC_AUTONOMOUS_REAL=false`). No se ejecuta ninguna escritura real; la UI lo indica ("Modo simulación").

1. Ingresar a SOEC y elegir el negocio de prueba.
2. Ir a **Conexión Meta** → iniciar conexión (OAuth) → conceder permisos → seleccionar la cuenta publicitaria.
3. Ir a **Campañas** → **paso 1**: fijar objetivo, presupuesto máximo, período y cuenta. Autorizar.
4. **Paso 2**: completar perfil del negocio y presupuesto de campaña → "Ver qué haría SOEC". Observar el plan (anuncios A/B, segmentación) y los pasos de ejecución simulada (gasto proyectado vs comprometido, `META_WRITE_CALLS=0`).
5. **Paso 3**: "Simular un ciclo autónomo" → ver decisiones (pausar bajo rendimiento) y, si aplica, una recomendación de aumento **que requiere aprobación humana**.
6. Probar **Freno de emergencia** y **Revocar autonomía** (efecto inmediato).
7. Ver superficies públicas: `/legal/privacidad`, `/legal/terminos`, `/legal/eliminacion-datos`, `/soporte`.

## 7. Escenarios de prueba (automatizados)

- **Contract tests** del write path real (con transporte simulado): creación de campaña/adset/creative/ad, pause/resume, publicación Facebook/Instagram, clasificación de errores (AUTH, SCOPE_MISSING, RATE_LIMIT, META_POLICY, INVALID_ASSET, INVALID_CREATIVE, NETWORK, CONFLICT). → `apps/api/test/meta-write-real.test.ts`
- **Idempotencia / reconciliación:** retry no duplica campaña/ad; resultado ambiguo no recrea. → `meta-write-recon.pg.test.ts`, `meta-write-real.test.ts`
- **Simulación adversarial:** ~1960 ciclos del loop completo; invariante `committed_spend ≤ authorized_budget` siempre. → `v2-adversarial-simulation.test.ts`
- **Master switch absoluto:** con `SOEC_AUTONOMOUS_REAL=false` el adapter real ni se instancia; 0 network writes. → `meta-write-real.test.ts`, `meta-write-architecture.test.ts`

## 8. Seguridad

- Cookies httpOnly, protección CSRF/Origin, security headers, rate limiting.
- Tokens cifrados (envelope + KMS), `secretRef` opaco, `appsecret_proof` en llamadas Graph.
- Aislamiento multi-tenant estricto; sin acceso cross-tenant.
- El transporte real no loggea token/secreto/payload; errores sanitizados y tipados.
- Retry solo cuando es demostrablemente idempotente (reconciliación two-phase).

## 9. Soberanía financiera (detalle)

El dinero se representa en enteros (minor units). El **mandato** es un tope duro creado solo por un humano. La máquina autónoma **no puede**: elevar `authorizedBudget`, extender período, cambiar moneda, renovar al agotarse, autorizarse a sí misma, ni interpretar silencio/histórico como autorización. Toda ampliación exige una nueva reautorización humana explícita. Esto vive en código determinista, no depende de LLM.

## 10. Guion de screencast (propuesto)

1. (0:00) Login y selección del negocio. "Todo lo que verán está en modo simulación; SOEC no publica ni gasta nada real."
2. (0:20) Conexión Meta: OAuth voluntario, concesión de permisos, selección explícita de la cuenta publicitaria.
3. (0:50) Fijar presupuesto máximo y período. "Este tope lo fija el usuario; SOEC nunca lo sube."
4. (1:20) Preparar campaña: mostrar anuncios A/B y los pasos simulados; señalar `META_WRITE_CALLS=0`.
5. (1:50) Ciclo autónomo: pausa de bajo rendimiento dentro del tope; recomendación de aumento que queda pendiente de aprobación humana.
6. (2:20) Freno de emergencia y revocar autonomía (inmediato).
7. (2:40) Superficies legales y de eliminación de datos.

## 11. Textos propuestos para App Review (por permiso)

- **ads_management:** "SOEC creates and manages ad campaigns on behalf of the business owner, strictly within a maximum budget the owner sets in advance. SOEC can create campaigns/ad sets/ads and pause or resume them, but never increases the authorized budget. All spend-affecting actions pass a deterministic Budget Guard and an append-only audit ledger."
- **pages_manage_posts:** "SOEC publishes organic content to the business's own Facebook Page only when the owner authorizes it, using official Graph endpoints. No content imitates human activity or evades Meta controls."
- **instagram_content_publish:** "SOEC publishes organic content to the business's own Instagram professional account, authorized by the owner, via official APIs."
- **pages_read_engagement:** "Required to resolve the Instagram professional account linked to the Page for organic publishing."

---

### Estado del veredicto pre-Meta

```
SOEC_AUTONOMOUS_REAL = false
META_WRITE_CALLS     = 0
REAL_MONEY_SPENT     = 0
```

Trabajo restante tras aprobación de Business Verification: solicitar Advanced Access / App Review de los scopes de escritura → OAuth incremental con esos scopes → cablear credencial/transporte real en la superficie (`META_WRITE_CONFIG_READY=true`, `META_GRANTED_SCOPES`) → piloto real controlado con presupuesto pequeño.
