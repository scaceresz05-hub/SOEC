# SOEC — Auditoría de brecha hacia una plataforma autónoma de marketing

**Fecha:** 2026-09-21 · **Rama auditada:** `cp/growth-5-1-geo-ads` (= `origin/recovery/integrate-main-multiorg` + fases 5 y 5.1) · **Naturaleza:** discovery, auditoría y gap analysis. **No se implementó, desplegó ni modificó nada**: este documento es el único archivo creado.

> **Actualización 2026-09-21 — Autonomy Fase 0 ejecutada.** Las cifras de este documento son las del
> **estado auditado** y se dejan intactas como línea base histórica. Lo resuelto después está en
> [../autonomy/RUNTIME_FOUNDATION.md](../autonomy/RUNTIME_FOUNDATION.md):
> P0-5 (ingesta server-side multiempresa, sin tarea de Windows), P0-13 (semántica única de modos, kill
> switch y pausa de seguridad gobernada) y P0-14 (las dos fugas de aislamiento), más el read model de salud
> de los trabajos de fondo que no figuraba en el backlog. P0-4 queda parcialmente resuelto: la ingesta ya es
> multiempresa, pero `stopMonitor` y `directorCycle` siguen fijados a una organización.

> **Actualización 2026-09-21 — Autonomy Fases A y B ejecutadas.** Las cifras de más abajo siguen siendo las
> del estado auditado (línea base histórica) y no se alteran. Lo resuelto después:
> [BUSINESS_AS_DATA.md](../autonomy/BUSINESS_AS_DATA.md) — el perfil del negocio es dato en PostgreSQL, con
> alta transaccional desde la interfaz (bloqueador 1 del TOP 5) — y
> [CONNECTIONS_AS_DATA.md](../autonomy/CONNECTIONS_AS_DATA.md) — conexiones, credenciales cifradas por tenant
> y capacidades operativas también son dato, y los bucles (`stopMonitor`, `directorCycle`, ingesta) descubren
> a quién cubren por capacidad persistida, sin ninguna organización fijada en código: **P0-4 queda cerrado**
> y el bloqueador 2 queda resuelto en su mitad de bucles (la creación de campaña sigue atada a un envelope
> literal). Por tanto, para una empresa nueva: `NEW_BUSINESS_REQUIRES_CODE_TODAY: NO` y
> `NEW_BUSINESS_REQUIRES_DEPLOY_TODAY: NO`, con una salvedad declarada — su **política de evaluación**
> (objetivo, criterio, límites, contexto del director) todavía no es dato, así que las experiencias REALES le
> responden `409 PROFILE_INCOMPLETE`. Los bloqueadores 4 y 5 siguen intactos.

> **Actualización 2026-09-21 — Autonomy Fase C ejecutada.** Cifras de línea base intactas.
> [EVALUATION_POLICY_AS_DATA.md](../autonomy/EVALUATION_POLICY_AS_DATA.md): la política de evaluación
> (objetivo, eventos de conversión, KPI, criterios de éxito/alerta/pausa/escalamiento, mínimos de evidencia y
> topes de autonomía) es dato tenant-scoped en PostgreSQL, con completitud explícita y motivos estructurados.
> Con esto **la salvedad de la actualización anterior queda cerrada**: una empresa nueva pasa a EVALUABLE
> configurando sus criterios desde la interfaz, y el perfil de SmileFlow reconstruido desde datos es idéntico
> campo por campo al de su módulo (prueba de paridad). `PROFILE_REGISTRY_DEPENDENCY` pasa de 1 empresa a 0
> para quien tiene política completa; el registro queda como referencia y rollback, no como dependencia
> operativa. El Director multiempresa se salta —con motivos— a los tenants incompletos, sin afectar a los
> demás. Los bloqueadores 4 y 5 del TOP 5 (motor de investigación/generación y optimización que ejecuta)
> siguen intactos: SOEC ya puede evaluar cualquier empresa, todavía no puede promocionarla sola.

> **Actualización 2026-09-21 — Autonomy Fase D ejecutada.** Cifras de línea base intactas.
> [INTELLIGENT_BUSINESS_ONBOARDING.md](../autonomy/INTELLIGENT_BUSINESS_ONBOARDING.md): existe el asistente
> que faltaba entre «crear una empresa» y «tenerla configurada». Una persona sin conocimientos de marketing
> digital contesta preguntas en lenguaje de negocio y SOEC las traduce a perfil, oferta, territorio, objetivo,
> conversiones, restricciones, política de evaluación, techo de inversión y modo operativo, con procedencia
> (`USER · WEBSITE · CONNECTOR · DERIVED`) y sin inventar umbrales (`TO_BE_LEARNED` / `SYSTEM_DEFAULT` /
> `UNCONFIGURED`). Se añade el read model `BusinessReadiness` por dominios y cinco niveles de preparación
> independientes, que sustituyen cualquier «porcentaje completo». **Con esto queda cubierto el inventario de
> onboarding que esta auditoría reclamaba** (§«onboarding inventory» y «universal form spec»): el recorrido
> `+ Nueva empresa → empresa preparada` ya no pasa por un desarrollador. Las capacidades derivadas son sólo de
> LECTURA; la ejecución de campañas y el gasto autónomo siguen exigiendo gobierno y una autorización
> financiera humana, y el asistente NO crea mandatos. Los bloqueadores 4 y 5 del TOP 5 (investigación y
> generación reales; optimización que ejecuta) siguen intactos: SOEC ya recibe, entiende y prepara una empresa
> sola, pero todavía no investiga el mercado ni propone campañas por sí mismo.

**Método:** lectura del código ejecutable (no de la documentación), distinguiendo qué está cableado en el runtime (`apps/api/src/server.ts`, rutas registradas en `app.ts`) de lo que existe como tipo, motor puro o fixture. Toda afirmación lleva evidencia `archivo:línea`. Vocabulario: `IMPLEMENTADO_Y_USADO · IMPLEMENTADO_PARCIAL · IMPLEMENTADO_PERO_NO_CONECTADO · MOCK · SOLO_TIPO_O_DOC · LEGACY · AUSENTE`.

---

## 0. Resumen ejecutivo

SOEC hoy es un **sistema de gobierno y evidencia para campañas de UNA empresa operada por un técnico**, no una plataforma que incorpore empresas y opere sola. Tiene mucho más rigor del habitual en lo que sí hace (event sourcing, guardarraíles fail-closed, política de privacidad ejecutable, ledgers, tests de arquitectura que prohíben SDKs de proveedor), y casi nada del recorrido que el producto objetivo exige antes y después de la campaña.

Tres hechos resumen la brecha:

1. **El negocio vive en código.** Incorporar una empresa es escribir un módulo TypeScript y añadir una línea a un array (`apps/api/src/plataforma/registro.ts:59-63`) y desplegar. Una empresa creada desde la UI existe en identidad pero recibe `404 ORGANIZATION_NOT_CONFIGURED` en `/plataforma/negocio`.
2. **Los bucles operativos son de una sola empresa.** `stopMonitor` y `directorCycle` están literalmente fijados a `'org-smileflow'` (`apps/api/src/server.ts:142,143,147,180`), y la creación real de campaña está anclada a un envelope y un `customerId` literales (`apps/api/src/campana/canary-execution.ts:26-32`).
3. **La ingesta de datos no está corriendo.** No vive en el servidor: la lanza una tarea de Windows (`scripts/ingesta-tick.cmd`) contra un Postgres local; esa tarea quedó deshabilitada el **2026-08-27** (`ingesta-autonoma.log`, última línea `FIN exit=1 estado=INFRA_ERROR`). CP Odontología nunca ha ingestado: su ejecución exige `SOEC_INGESTA_ORG`, que ningún lanzador define.

**CURRENT_SOEC_ROLE:** sistema de decisión y gobierno, con lectura real de Google Ads y Meta, una única mutación autónoma (pausar campaña por stop-loss) y una creación de campaña asistida por humano, todo para una empresa cableada en código.

**TARGET_SOEC_ROLE:** `AUTONOMOUS_MARKETING_PLATFORM`.

---

## 1. Qué corre realmente hoy (runtime observado)

| Bucle | Evidencia | Cadencia | Organizaciones | Capacidad máxima |
|---|---|---|---|---|
| `metaScheduler` | `server.ts:102-110`, `acquisition/meta-scheduler.ts:47` | 5 min | **multi-tenant** (toda conexión `CONNECTED_READ_ONLY`) | OBSERVA (GET a Graph) |
| `googleAdsScheduler` | `server.ts:115-133` | 3 h | multi-tenant | OBSERVA; **activo en producción** (`GOOGLE_ADS_SCHEDULER_ENABLED=true`) |
| `stopMonitor` | `server.ts:139-148`, `campana/google-ads-pause-adapter.ts:55-79` | 5 min | **`org-smileflow` hardcodeado** | **EJECUTA**: pausa real de campaña |
| `directorCycle` | `server.ts:173-181`, `autonomia-ads/director-cycle.ts` | 5 min | **`org-smileflow` hardcodeado** | DECIDE (persiste; 0 escrituras) |
| Ingesta Growth/Ads | `apps/api/scripts/ingest-all.ts:31` | — | 1 org por corrida (`SOEC_INGESTA_ORG ?? org-smileflow`) | **NO CORRE** desde 2026-08-27 |

Variables de producción (34) confirmadas: no existe `SOEC_AUTONOMOUS_REAL`; sí `GOOGLE_ADS_SCHEDULER_ENABLED=true`, `CP_ODONTOLOGIA_GROWTH_TOKEN`, `CP_ODONTOLOGIA_M2M_URL`.

### 1.1 Dos hallazgos de gobierno que conviene resolver antes de ampliar autonomía

- **La única mutación autónoma del sistema está fuera del árbol de interruptores.** `StopMonitorService.decidir` (`campana/stop-monitor.ts:119-139`) llama a `pausarCampania` sin consultar `supervisedReal`, `AUTONOMOUS_REAL` ni kill-switch, mientras `stop-monitor.ts:6-8` y `server.ts:136` afirman lo contrario. Es una acción reductora de riesgo (body fijo `{status:'PAUSED'}`), pero la documentación y el código no dicen lo mismo.
- **`SUPERVISED_REAL` significa dos cosas opuestas.** El dominio lo define como «SIN publicación/envío/gasto/mutación externa aún» (`packages/identity/src/domain/modo.ts:6-7`), y sin embargo es exactamente el gate que habilita la creación real de campaña con compromiso de gasto (`campana/authorized-execution-envelope.ts:107-109`). Cualquier miembro con `operational_mode.manage` puede cambiarlo (`organizations-routes.ts:85-92`).
- **Aislamiento con dos fugas conocidas:** `GET /plataforma/negocios` devuelve todas las empresas del registro a cualquier usuario autenticado, con `filtradoPorMembresia: false` y la limitación escrita en el propio comentario (`plataforma-routes.ts:124-144`); y `director-autonomo-programas-routes.ts:23-40` toma la organización del cuerpo/URL en lugar del contexto autenticado.

---

## 2. Onboarding de una empresa nueva (§5 del encargo)

| Pregunta | Hoy | Qué exige |
|---|---|---|
| ¿Crear organización desde la UI? | **SÍ** — `apps/web/app/select-organization/page.tsx:45-55` → `POST /organizations` → PostgreSQL | nada |
| ¿Definir tipo de negocio? | **NO** | archivo TS + registry + deploy |
| ¿Registrar productos/servicios? | **NO** como perfil (se re-teclean en cada simulación de `/campanas`) | código |
| ¿Registrar territorio? | **NO** — 9 comunas escritas a mano (`negocios/org-cp-odontologia.ts:51-57`) | código |
| ¿Indicar objetivos? | **PARCIAL** — `/director-workspace` persiste decisiones, no perfil | código para el perfil |
| ¿Indicar presupuesto? | **SÍ** — mandato real desde `/campanas` (`accion/mandato.ts`, PG) | nada |
| ¿Registrar canales actuales? | **NO** (`negocios/*.ts` `canales:[]`) | código |
| ¿Vincular sitio web? | **NO** | código |
| ¿Declarar conversiones deseadas? | **NO** — embudo constante (`org-cp-odontologia.ts:105-108`) | código |
| ¿Modalidad comercial / restricciones / privacidad? | **NO** — la privacidad es regla global (`ingesta/politica-privacidad-growth.ts`) | código |
| ¿Conectar Google Ads? | **SÍ** — OAuth completo multi-tenant, cifrado con KMS | usuario |
| ¿Conectar Meta? | **SÍ** — OAuth read-only + binding de activos | usuario |
| ¿Conectar analytics (GA4)? | **NO** — sólo etiqueta «No configurado» en el panel | no existe |

**`/onboarding` es un `redirect('/negocios')`** (`apps/web/app/onboarding/page.tsx:3-5`). No existe asistente. Las 6 rutas de `plataforma-routes.ts` son **todas GET**: no hay ninguna API de escritura del perfil comercial.

Dos superficies que **sí** persisten perfil existen pero no están conectadas a la plataforma: `POST /commercial-knowledge/entities` (event store, responde `naturaleza:'SIMULADO'`, sin pantalla) y `POST /experience/director-autonomo/organizaciones` (demo con IDs fijos).

---

## 3. Formulario/asistente universal que falta (§6)

Especificación mínima para servir a clínica, SaaS, ecommerce, servicios, negocio local, B2B y B2C. Clasificación: **O** obligatoria · **C** condicional · **D** derivable · **S** obtenible del sitio · **P** obtenible de Google/Meta.

| Dato | Clase | Cómo se obtiene sin preguntar |
|---|---|---|
| Nombre comercial y razón social | O | — |
| Sitio web | O | — |
| ¿Qué hace la empresa? (1 frase) | O | S — `<title>`, H1, schema.org |
| Tipo de negocio / rubro | D | S — clasificación desde el sitio; confirmar con el usuario |
| Productos o servicios | D | S — páginas de servicio/producto; **P** — catálogo Woo/Shopify si existe |
| Lo que quiere potenciar | O | — (decisión comercial) |
| Territorio de venta | O | S — dirección/schema; P — configuración geográfica de Ads existente |
| Modalidad comercial (B2B/B2C, particular/seguro/convenio) | C | S — páginas de precios/condiciones |
| Cómo contactan hoy los clientes | D | S — CTA del sitio (WhatsApp, teléfono, formulario, carrito) |
| Conversiones a medir | D | Derivado de lo anterior; confirmar |
| Medición instalada | D | S — detectar GA4/GTM/píxel/etiqueta Ads en el HTML |
| Cuentas publicitarias existentes | D | P — OAuth: `listAccessibleCustomers`, `me/adaccounts` |
| Historial de gasto y CPC | D | P — Ads/Meta |
| Inversión máxima mensual y diaria | O | — (mandato financiero) |
| Variación automática permitida | O | — |
| Canales permitidos y prohibidos | O | — |
| Afirmaciones prohibidas / restricciones legales | O | Semillas por rubro; confirmar |
| Competidores conocidos | C | — |
| Estacionalidad | C | P — histórico |

Regla de diseño: **nada que SOEC pueda descubrir se pregunta**; lo que descubre se muestra para confirmar. Hoy no existe ninguna de las derivaciones **S** (no hay lectura de sitios) y las **P** existen sólo tras conectar OAuth.

---

## 4. Investigación autónoma (§7)

| Capacidad | Estado | Evidencia / qué falta |
|---|---|---|
| Leer/auditar un sitio web | **AUSENTE** | `campana/diagnosis-evidence.ts:4`: el diagnóstico ocurre «FUERA de SOEC»; se ingiere el resultado declarado por un humano |
| Detectar productos/servicios | **PARCIAL** | Sólo WooCommerce real (`ingesta/woocommerce-store-adapter.ts:79-110`) y sólo por CLI (`scripts/ingest-comercio.ts`) |
| Detectar conversiones disponibles | **AUSENTE** | Cero referencias a `conversion_action`; el embudo es constante por empresa |
| Auditoría SEO | **AUSENTE** | `seo` sólo como campo de formulario manual (`crm-comercial/.../perfiles.ts:43`) |
| Análisis de competencia | **PARCIAL** | Esquema de captura manual; sólo se clasifican términos de marca ya observados (`campana/intent-classifier.ts:14-18`) |
| Investigación de keywords | **PARCIAL** | Retrospectiva sobre `search_term_view` ya pagado (`ingesta/mapa-google-ads.ts:65`); no hay descubrimiento |
| Keyword Planner | **AUSENTE** | Los únicos endpoints de Google son token, `searchStream` y `listAccessibleCustomers` (`acquisition/google-ads-api-http.ts:10-11`) |
| Demanda geográfica | **AUSENTE** | Existe resolución nombre→`criterionId` (`campana/google-ads-mutate-http.ts:285-302`), no datos de demanda |
| CPC / competencia | **PARCIAL** | CPC observado real; sin CPC estimado ni nivel de competencia |
| Tendencias | **AUSENTE** | Sólo campo manual |
| Identificación de negativas | **PRESENTE** (propone) | `autonomia-ads/capacidad-negativa.ts`; ejecución bloqueada |
| Incoherencia landing↔keyword | **PARCIAL** | `campana/marketing-plan.ts:316-320`, sobre destinos declarados por un humano |
| Oportunidades orgánicas | **PARCIAL** | Sólo oportunidades tácticas de mensaje en Ads (`autonomia-ads/intencion.ts:142-147`) |

**Hallazgo estructural:** no existe ningún cliente de LLM ni de API de investigación en el monorepo. La única «inteligencia» es `DeterministicIntelligenceProvider` (`packages/intelligence/src/index.ts:15,31`), cableada en `server.ts:26`. Los nombres de SDK (`openai`, `anthropic`, `gemini`, `googleapis`…) aparecen **sólo en tests de arquitectura que los prohíben** (`packages/adaptadores/test/architecture.test.ts:43`). Es una decisión de diseño deliberada, y es el motivo por el que la investigación y la redacción han dependido de un agente externo.

---

## 5. Motor de estrategia — «Marketing Director» (§8)

| Dimensión | Nivel real |
|---|---|
| Qué canal usar | *recommendation only* — `adquisicion/director-multicanal.ts:50-56` fuerza `recomendacion: null`, `naturaleza:'SHADOW'` |
| Qué servicio promocionar | *recommendation only* — es input humano en `/campanas` |
| Cuánto presupuesto asignar | *decision persisted*, nunca ejecutable (`autonomia-ads/decision-service.ts:100-105`); el aumento es recomendación con `autoAplicable:false` (`autonomia/decision-engine.ts:29-36`) |
| Qué territorio | *decision persisted* dentro de una política constante `GEO_SMILEFLOW_V2` (`campana/geo-policy.ts:23`) |
| Qué keywords | *decision persisted* (borrador) |
| Qué landing | *recommendation only* — `CHANGE_LANDING` declarada como trabajo humano externo |
| Qué campaña crear | *executable decision* — `POST /medicion/canary-execute`, humano, anclada a org/customer/envelope literales |
| Qué objetivo / qué KPI | *decision persisted* (registro humano append-only) |
| Qué campaña evitar / detener | **autonomous execution** — stop-loss |

Ninguna dimensión estratégica alcanza ejecución autónoma. La única ejecución autónoma del sistema (la pausa) no forma parte del Director.

---

## 6. Creación real de campañas (§9)

| Acción | Google Ads | Meta |
|---|---|---|
| Crear campaña | **API_REAL** (gated) `campana/google-ads-materializer.ts:78-95` | **MOCK** `campana/meta-write-factory.ts:32-35` nunca devuelve el adapter real |
| Crear grupos / conjuntos | **API_REAL** `:99-102` | MOCK |
| Crear anuncios | **API_REAL** (RSA) `:104-106` | MOCK |
| Crear keywords | **API_REAL** `:110-115` | n/a |
| Crear negativas (alta) | **API_REAL** `:118-120` | n/a |
| Ubicación | **API_REAL** `:123-125` + `geoTargetConstants:suggest` | MOCK (`segmentacion` es un string libre, no un objeto `targeting`) |
| Idioma | **AUSENTE** (0 referencias a `language_constant`) | AUSENTE |
| Presupuesto (alta) | **API_REAL** `:74-76` | MOCK |
| Puja | **API_REAL pero fija** (`maximizeConversions`, sin techo de CPC) | AUSENTE |
| Assets / extensiones | **AUSENTE** | MOCK (sólo texto; sin subida de archivos) |
| Crear conversiones | **AUSENTE** | AUSENTE (pixel/CAPI inexistente) |
| Vincular conversiones | **MANUAL** (atestación humana) | AUSENTE |
| Pausar | **API_REAL** `campana/google-ads-pause-adapter.ts:55-79` | MOCK |
| Reanudar | **AUSENTE** (excluida por diseño) | MOCK |
| Cambiar presupuesto / puja | **AUSENTE** | AUSENTE (en denylist financiero) |
| Añadir/quitar keywords post-lanzamiento | **AUSENTE** | n/a |
| Negativas desde search terms | **MOCK/dry-run** (`autonomia-ads/google-ads-write-adapter.ts:79-83` lanza siempre) | n/a |
| Modificar anuncios | **AUSENTE** | MOCK |
| Leer métricas / search terms | **API_REAL READ_ONLY** | **API_REAL READ_ONLY** |
| OAuth / refresco / MCC | **API_REAL** (MCC: sólo lectura; el vínculo es manual) | **API_REAL** (scopes de escritura en denylist: `acquisition/meta-oauth.ts:29-36`) |

Guardarraíles del alta real (7 capas fail-closed, `campana/authorized-execution-envelope.ts:229-255`): modo operativo → estado del envelope → `planHash` → canal → allowlist de acciones → gate externo (tracking/landing) → guardrail de cero conversión → tope total. Más `validateOnly:true` real contra Google, `partialFailure:false`, anti-duplicado, allowlist de hosts default-deny y ledger de intentos con `requestId`.

**Hueco material:** `PgBudgetAuthorizationRepo.guardar` (`autonomia-ads/budget-authorization-pg.ts:83`) no se invoca desde ninguna ruta de producción; el guardrail financiero responde permanentemente `SIN_CAP_AUTORIZADO`, de modo que `CAP_REACHED` es inalcanzable por esa vía.

---

## 7. Medición automática (§10)

| Capacidad | Estado |
|---|---|
| Detectar conversiones de un sitio | **AUSENTE** |
| Instalar/taggear (GA4, GTM, píxel, etiqueta Ads) | **SOLO_TIPO_O_DOC** (`packages/comercio/.../embudo.ts:62-70`) |
| Verificar disparo (firing) | **AUSENTE** |
| Conectar Google Ads | **IMPLEMENTADO_Y_USADO** (OAuth + KMS + refresco + reautorización) |
| Conectar Meta | **IMPLEMENTADO_Y_USADO** (read-only, scheduler activo) |
| Conectar GA4 | **AUSENTE** (ni cliente, ni ruta, ni OAuth) |
| Recibir eventos propios (puente Growth) | **IMPLEMENTADO_Y_USADO** el adaptador (genérico, agnóstico de empresa: `ingesta/growth-adapter.ts:44-129`) · **NO CONECTADO** la ejecución |
| Política de privacidad de la ingesta | **IMPLEMENTADO_Y_USADO**, fail-closed (`ingesta/politica-privacidad-growth.ts:115-152`), cableada en `mapa-growth.ts:74` |
| Baseline | **PARCIAL** (real en ventas ecommerce; 0 en Ads) |
| CPA / CVR | **PARCIAL**: las fórmulas existen (`packages/medicion/src/domain/indicator.ts:53-86`) pero las filas reales fijan `conversiones = 0` (`real-director/fuente-metricas-real.ts:50`), así que el resultado es `null` por construcción |
| Ingresos / ROI | **NO CONECTADO**: `real-director/lectura-director-real.ts:295-303` cablea `ingresos: 0` |
| Atribución Ads ↔ Growth | **AUSENTE por diseño declarado** (`ingesta/panel-resultados.ts:97-101`: `demosAtribuiblesAds: null`) |

Y, sobre todo: **la ingesta no corre**. El scheduler de ingesta (`ingesta/scheduler.ts`) no lo importa `server.ts`; sólo lo usa el script `ingest-all.ts`, que procesa **una** organización por corrida y cuya tarea programada está deshabilitada desde 2026-08-27. La fuente Growth de CP está declarada `CONNECTED_READ_ONLY` (`org-cp-odontologia.ts:122`) sin que exista ningún ejecutor que la consuma.

---

## 8. Autonomía después del lanzamiento — matriz obligatoria (§11)

Nivel máximo real hoy, para la única organización cableada (`org-smileflow`):

| Capacidad | OBSERVA | RECOMIENDA | DECIDE | EJECUTA |
|---|:--:|:--:|:--:|:--:|
| Ingestión periódica | — | — | — | **✔** (pero detenida en la práctica) |
| Evaluación de resultados | ✔ | ✔ | **✔** | ✖ |
| Stop-loss | ✔ | ✔ | ✔ | **✔** |
| Detección de cero conversiones | ✔ | ✔ | ✔ | **✔** |
| Reasignación de presupuesto | ✖ | ✖ | ✖ | ✖ |
| Aumento de presupuesto | ✔ | **✔** | ✖ | ✖ |
| Disminución de presupuesto | **✔** | ✖ | ✖ | ✖ |
| Cambios de CPC / puja | ✔ | **✔** | ✖ | ✖ |
| Negativas desde search terms | ✔ | ✔ | **✔** | ✖ (dry-run estructural) |
| Pausa de keywords | ✖ | ✖ | ✖ | ✖ |
| Pausa de anuncios | ✔ | **✔** | ✖ | ✖ |
| Pruebas A/B de anuncios | ✖ | ✖ | ✖ | ✖ |
| Creación de variantes | ✔ | **✔** | ✖ | ✖ |
| Decisión de escalar | ✔ | ✔ | **✔** | ✖ |
| Detección de fatiga | ✖ | ✖ | ✖ | ✖ |
| Control de frecuencia (anuncios) | ✖ | ✖ | ✖ | ✖ |
| Comparación entre canales | **✔** | ✖ | ✖ | ✖ |
| Redistribución Google ↔ Meta | ✖ | ✖ | ✖ | ✖ |
| Cierre de experimento | ✔ | ✔ | **✔** | ✖ |
| Generación del siguiente experimento | ✔ | ✔ | **✔** | ✖ |

---

## 9. Gobernanza de dinero y de riesgo (§12, §13)

**Existe:** mandato humano con presupuesto, período, activos y acciones permitidas (`accion/mandato.ts`, `accion/budget-guard.ts`, `accion/ledger.ts`, creación desde `/campanas` con `business.manage`); envelope de ejecución autorizada con `totalCap`, `experimentBudget` y `maxSpendWithoutContact`; límites por organización (`autonomia-ads/limites-smileflow.ts:33-40`: 2.000 CLP/día, techo CPC 1.000, variación 15 %, 2 cambios/día, cooldown 72 h); kill switch; denylist de acciones financieras; auditoría y ledgers.

**Falta:** que el usuario declare el mandato en lenguaje de negocio (techo mensual y diario, variación permitida, canales permitidos, acciones prohibidas) **desde el onboarding**, que ese mandato gobierne todos los canales, y que la autorización de presupuesto se persista (hoy la escritura está huérfana). Falta también un modelo de niveles de autonomía por empresa/canal/acción: hoy la autonomía es binaria y global, y `AUTONOMOUS_REAL` es una constante de compilación (`packages/cia/src/dominio/guardarrailes.ts:12`).

**Clasificación propuesta** (no implementada): *autónomas* — pausar, añadir negativas, ajustar puja y presupuesto dentro de la banda del mandato, rotar anuncios; *requieren aprobación* — superar el techo, abrir un canal nuevo, nuevas afirmaciones comerciales, cambiar territorio, reanudar lo pausado por stop-loss; *prohibidas* — gasto sin mandato vigente, afirmaciones sin respaldo, tocar datos personales, publicar sin aprobación de claims.

---

## 10. Creativos y landings (§14, §15)

Creativos: **generar copy/RSA/variantes = PRESENTE pero determinista** (plantillas e interpolación, `campana/content-engine.ts:55-81`, `campana/marketing-plan.ts:287-307`, que nunca trunca ni inventa: si no alcanza, emite `PENDING_COPY`). **Verificar claims, versionar y aprobar = PRESENTE y fuerte** (`packages/estrategia-creativa/.../validador-contenido.ts`, `orquestador-generativo.ts:311-320`, aprobaciones ligadas a la versión del artefacto). **Imágenes y video = AUSENTES**: los activos visuales son especificaciones de texto por diseño (`packages/contenido/src/domain/activo.ts:2-6`). **Publicar = bloqueado** (`generacion-routes.ts:139-141` responde `422 MODO_REAL_BLOQUEADO`).

Landings: SOEC puede **detectar que falta** una landing sólo si un humano declaró los destinos válidos (`marketing-plan.ts:319` → `PENDING_DESTINATION`), y **recomendarla como hipótesis** (`CHANGE_LANDING`, con el riesgo «requiere rediseño» explícito). No puede generar especificación, crearla, publicarla, optimizarla ni hacer A/B de páginas. Es exactamente lo que ocurrió con `/odontologia-general/`.

---

## 11. Multi-org real (§16)

Añadir una empresa exige hoy: **(1)** un módulo TypeScript nuevo; **(2)** dos líneas en `registro.ts`; **(3)** deploy; **(4)** variables de entorno por empresa; **(5)** en algunos casos un archivo de secretos en el disco del servidor (`plataforma/deposito-secretos.ts:29-35`); **(6)** alta separada en identidad; **(7)** módulos adicionales si necesita criterio, límites o ingesta propia. La «puerta de extensión» (`crearResolutorDeNegocios`) existe y está probada… **en un test** (`apps/api/test/cyp-onboarding.test.ts`), no expuesta en runtime.

Todo esto es **deuda P0**: bloquea el producto entero.

---

## 12. Experiencia de usuario (§2, §17-D)

La navegación real tiene 6 enlaces (`apps/web/app/layout.tsx:26-31`) sobre ~25 rutas existentes: seis páginas operativas (`/marketing`, `/contenido`, `/canales`, `/control`, `/medicion`, `/piloto`) funcionan contra organizaciones **demo hardcodeadas** (`pyme-*-demo`) y no están en el menú; cinco rutas son `redirect` a `/negocios`.

Lo mejor que existe en experiencia es `/evaluacion`: preguntas de negocio puro, autoguardado, sustento por respuesta — pero su biblioteca es sólo **clínica dental** (`packages/rubros/src/rubros/registro.ts:13-19`). Lo peor son `/resultados` y `/campanas`, que exigen vocabulario técnico (match types, `keyword/campaign/diff`, CPC, elegir cuentas publicitarias por ID).

---

## 13. Matriz de madurez (§18)

**Criterio de puntuación.** Cada dominio tiene una lista explícita de capacidades; cada una vale 1 si está **implementada y cableada en runtime para cualquier organización**, 0,5 si es parcial (existe pero limitada, no conectada, dry-run o de una sola empresa) y 0 si falta. `COVERAGE = suma / nº de capacidades`, redondeado. En optimización se usa la escala de 4 niveles de la matriz §8 (OBSERVA 0,25 · RECOMIENDA 0,5 · DECIDE 0,75 · EJECUTA 1).

| Dominio | Estado | Coverage | Evidencia principal | Bloqueador |
|---|---|---:|---|---|
| Onboarding | PARTIAL | **38 %** | `select-organization` + OAuth vs. perfil en código | Alta de empresa no operable sin deploy |
| Business model / perfil | MISSING | **19 %** | `plataforma/negocios/*.ts`, sin API de escritura | Sin persistencia del perfil |
| Data sources | PARTIAL | **38 %** | OAuth Ads/Meta por tenant; Growth genérico; GA4 ausente | Declaración en código; sin GA4 |
| Market research | MISSING | **31 %** | §4 | Sin lectura de sitio, sin Planner, sin IA |
| Strategy | PARTIAL | **50 %** | §5 | Nada llega a ejecución autónoma |
| Campaign planning | PARTIAL | **63 %** | `marketing-plan.ts` completo, con quality gates | Depende de datos declarados por humanos |
| Campaign creation | PARTIAL | **53 %** | §6 (Google real; Meta mock) | Anclada a contexto literal; sin conversiones |
| Creative generation | PARTIAL | **50 %** | §10 | Determinista; sin imágenes/vídeo; sin publicar |
| Conversion tracking | PARTIAL | **38 %** | §7 | No detecta, no instala, no verifica; CPA null |
| Execution (post-lanzamiento) | PARTIAL | **46 %** | Matriz §8 | Sólo PAUSE ejecuta; una sola org |
| Optimization | PARTIAL | **46 %** | Matriz §8 | Negativas/puja/presupuesto en dry-run |
| Budget governance | PARTIAL | **50 %** | Mandato + envelope reales | Autorización huérfana; sin bandas |
| Risk governance | COMPLETE* | **92 %** | Allowlists, ledgers, kill switch, auditoría | *Semántica de modos contradictoria |
| Reporting | PARTIAL | **67 %** | Panel + post-mortem + honestidad de ausencia | Sin informe periódico |
| Multi-org | PARTIAL | **43 %** | Identidad y OAuth por tenant sólidos | Registro en código; bucles mono-org |
| User experience | PARTIAL | **44 %** | §12 | Sin asistente; superficies demo; jerga |
| Autonomous operation | MISSING | **34 %** | §1, §8 | Ingesta detenida; ciclo no cerrado |

### Índices de la entrega

Ponderación (suma 100): onboarding 15 · research 10 · strategy 10 · campaign creation 15 · measurement 15 · optimization 15 · budget 5 · multi-org 10 · UX 5.

`SOEC_AUTONOMY_READINESS = 0,15·38 + 0,10·31 + 0,10·50 + 0,15·53 + 0,15·38 + 0,15·46 + 0,05·50 + 0,10·43 + 0,05·44 = **43 %**`

Este 43 % mide **cobertura de componentes**, no el recorrido completo. El recorrido «empresa nueva → primera campaña optimizándose sola» está **bloqueado en tres eslabones** (perfil en código, bucles mono-org, ingesta detenida), de modo que hoy su valor efectivo es ~0: ninguna empresa nueva puede recorrerlo sin desarrollador.

---

## 14. Trabajo faltante (§19)

### P0 — imprescindible para autonomía (14 capacidades)

| # | Capacidad | Estado | Compl. | Dependencias | Riesgo | Módulos afectados | Migración | API externa | Credenciales |
|---|---|---|:--:|---|---|---|:--:|:--:|:--:|
| 1 | Perfil de negocio persistido (DB/event store) + API de escritura | MISSING | L | — | Medio | `plataforma/*`, nuevas rutas | Sí | No | No |
| 2 | Registro de negocios dinámico + binding identidad↔negocio | MISSING | L | 1 | **Alto** (toca el resolutor que hoy es fail-closed) | `plataforma/registro.ts`, `experience-binding.ts` | Sí | No | No |
| 3 | Asistente de alta con preguntas de negocio | MISSING | M | 1,2 | Bajo | `apps/web`, `rubros` | No | No | No |
| 4 | Bucles operativos parametrizados por tenant | MISSING | M | 2 | **Alto** (SmileFlow en producción) | `server.ts`, `director-cycle`, `stop-monitor` | No | No | No |
| 5 | Ingesta programada multiempresa dentro del servidor | MISSING | M | 2 | Medio | `ingesta/scheduler.ts`, `server.ts` | No | No | Sí (por org) |
| 6 | Declaración de fuentes por organización desde UI/DB | MISSING | L | 1,2 | Medio | `plataforma/*`, `ingesta/*`, `secretos` | Sí | No | Sí |
| 7 | Creación de campaña Google generalizada (sin contexto literal) | PARTIAL | M | 2,4 | **Alto** (dinero real) | `campana/canary-*`, `geo-policy` | No | Sí | Sí |
| 8 | Conversiones en Google Ads: crear, vincular, verificar | MISSING | L | 7 | Alto | nuevo adaptador + `measurement-routes` | No | Sí | Sí |
| 9 | Optimización ejecutable (negativas, pausa keyword/ad, presupuesto, puja) | PARTIAL | L | 4,7,10 | **Alto** | `autonomia-ads/*`, `campana/*` | No | Sí | Sí |
| 10 | Mandato financiero operante (persistir autorización, bandas de variación) | PARTIAL | M | 1 | Alto | `autonomia-ads/budget-authorization-pg.ts`, `accion/*` | Sí | No | No |
| 11 | Motor de investigación mínimo (leer sitio, extraer servicios y conversiones, keywords) | MISSING | XL | — | Medio | nuevo paquete + `adaptadores` | No | Sí | Sí |
| 12 | Generación creativa con proveedor real gobernado | PARTIAL | L | 11 | Medio (claims) | `contenido`, `adaptador-generativo-externo`, tests de arquitectura | No | Sí | Sí |
| 13 | Coherencia de modos y gates (stop-monitor, `SUPERVISED_REAL`) | PARTIAL | S | — | Bajo | `identity/modo.ts`, `stop-monitor.ts`, `server.ts` | No | No | No |
| 14 | Cierre de las dos fugas de aislamiento | PARTIAL | S | — | **Alto** (seguridad) | `plataforma-routes.ts`, `director-autonomo-programas-routes.ts` | No | No | No |

`P0_COMPLETE: 0 · P0_PARTIAL: 6 · P0_MISSING: 8`

### P1 — producto comercial completo (12)

Meta escritura real gobernada (PARTIAL, L) · GA4 conexión e ingesta (MISSING, M) · instalación y verificación de medición (MISSING, L) · atribución Ads↔Growth respetando privacidad (MISSING, L) · A/B de anuncios con decisión por métrica (MISSING, M) · fatiga y frecuencia en Meta (MISSING, M) · comparación y redistribución entre canales (MISSING, L) · imágenes/vídeo o biblioteca de activos (MISSING, L) · landings: especificación, publicación y medición (MISSING, XL) · informe periódico al usuario (MISSING, S) · onboarding multi-rubro más allá de clínica dental (PARTIAL, M) · consolidación de superficies demo y rutas huérfanas (PARTIAL, M).

`P1_COMPLETE: 0 · P1_PARTIAL: 3 · P1_MISSING: 9`

### P2 — optimización y escala (8)

Keyword Planner y Trends (MISSING, M) · competencia automatizada (MISSING, L) · experimentación con significancia estadística (MISSING, M) · asignación multicanal tipo bandit (MISSING, L) · facturación self-serve (MISSING, L) · benchmarks por rubro (PARTIAL, M) · SLO y observabilidad de bucles (PARTIAL, S) · multi-moneda e internacionalización (MISSING, M).

`P2_COMPLETE: 0 · P2_PARTIAL: 2 · P2_MISSING: 6`

---

## 15. Arquitectura objetivo (§20)

Reutiliza lo que existe; **no requiere reescritura**. En negrita lo que ya existe y sirve; entre corchetes lo que falta.

```
[Business Onboarding Wizard]           → apps/web (nuevo) ──┐
                                                            ▼
[Business Profile Store]  (perfil, territorio, embudo, mandato, restricciones — DB + event store)
        │  reemplaza plataforma/negocios/*.ts como fuente de verdad
        ▼
**Source Connectors**  OAuth Google Ads · OAuth Meta · puente Growth genérico · [GA4] · [ecommerce]
        │  (ya multi-tenant y cifrados con KMS)
        ▼
[Research Engine]  lectura de sitio · extracción de servicios y conversiones · keywords · [Planner]
        │
        ▼
**Marketing Director** (motor de decisión existente, parametrizado por tenant)
        ├── **Campaign Planner**  marketing-plan.ts (quality gates, hipótesis, destinos)
        ├── **Creative Engine**   plantillas + validador de claims + versionado + aprobaciones
        │        └── [proveedor generativo real detrás del puerto ya definido]
        └── **Decision Engine**   decisiones persistidas en el event store
        ▼
**Budget Guardrails** (mandato + envelope) · **Risk Guardrails** (allowlists, denylist financiero, kill switch)
        ▼
**Campaign Executor**   Google: alta real + pausa (existen) · [update de presupuesto/puja/keywords] · [Meta write]
        ▼
**Measurement**  ingesta Growth (genérica) · Ads/Meta read · [conversiones e instalación] · [atribución]
        ▼
**Event Store** (SSOT append-only, ya transversal)
        ▼
**Scheduler** [multiempresa, dentro del servidor] · **Stop Monitor** [por tenant] · [Optimizer] · [Experiment Manager]
        ▼
**Reporting** (panel + post-mortem) · [informe periódico]
```

Piezas que ya existen y no hay que rehacer: event store y proyecciones, identidad y aislamiento, OAuth y custodia de secretos, envelope y mandato, planificador de campaña, validadores de contenido, política de privacidad de ingesta, ledgers y auditoría, panel.

Piezas nuevas: perfil de negocio persistido, registro dinámico, asistente, motor de investigación, optimizador ejecutable, gestor de experimentos, conectores GA4/conversiones, motor de landings.

`CRITICAL_ARCHITECTURE_REWRITE_REQUIRED: NO`

---

## 16. Roadmap (§21)

Cada fase entrega valor usable, preserva SmileFlow y CP, tiene criterio de salida objetivo y termina en commit verificable con tests.

**Fase A — El negocio como dato.** Perfil persistido + registro dinámico + binding identidad↔negocio, migrando SmileFlow, CYP y CP desde los módulos TS (que quedan como semilla de migración). *Salida:* una empresa creada desde la UI responde 200 en `/plataforma/negocio` y aparece en el panel; los tres negocios actuales siguen idénticos byte a byte en sus respuestas.

**Fase B — Alta guiada y mandato.** Asistente con preguntas de negocio, declaración de fuentes y mandato financiero (techo mensual/diario, variación, canales permitidos, prohibiciones). *Salida:* alta completa de una cuarta empresa ficticia sin tocar código ni desplegar.

**Fase C — Datos que llegan solos.** Scheduler de ingesta multiempresa dentro del servidor, con lease por organización; CP ingestando de verdad. *Salida:* observaciones de dos organizaciones distintas en producción sin tarea externa, y el guardrail financiero con autorización persistida.

**Fase D — Operación por tenant.** `stopMonitor` y `directorCycle` parametrizados; envelope y política geográfica por organización; corrección de la semántica de modos y de las dos fugas de aislamiento. *Salida:* dos organizaciones con bucles activos simultáneos y aislados, SmileFlow con su comportamiento actual intacto.

**Fase E — Investigación mínima.** Lector de sitio (servicios, conversiones instaladas, coherencia landing↔keyword) + keywords desde search terms y Planner. *Salida:* alta de empresa que propone servicios y conversiones detectados, confirmados por el usuario.

**Fase F — Optimización ejecutable.** Negativas, pausa de keywords y anuncios, presupuesto y puja dentro de las bandas del mandato, con rollback y ledger. *Salida:* un ciclo real en el que SOEC aplica al menos tres tipos de cambio sin intervención, dentro del mandato.

**Fase G — Creatividad y canal ampliado.** Proveedor generativo real detrás del puerto existente (con los validadores de claims como gate), Meta write gobernado, conversiones de Google Ads. *Salida:* campaña creada y optimizada en dos canales con claims aprobados.

**Fase H — Experimentos y landings.** Gestor de experimentos con criterio estadístico, especificación y publicación de landings, informe periódico. *Salida:* el ciclo del §1 del encargo cerrado extremo a extremo para una empresa nueva.

---

## 17. CP Odontología como prueba de realidad (§22)

Cada intervención registrada en la incorporación de CP, y cómo debería haberla resuelto SOEC.

| # | Qué hubo que hacer | Herramienta | Cómo debería haberlo resuelto SOEC |
|---|---|---|---|
| 1 | Escribir `org-cp-odontologia.ts` (253 líneas: identidad, territorio, embudo, fuentes) | Claude Code + deploy | Asistente de alta: el usuario responde y el perfil se persiste (P0-1, P0-3) |
| 2 | Añadir dos líneas a `registro.ts` y desplegar | Claude Code + deploy | Registro dinámico desde datos (P0-2) |
| 3 | Crear la organización y su membresía | API | Ya resuelto: es el único paso que hoy funciona |
| 4 | Declarar la fuente Growth (provider, host, ruta, credencial) | código | Declaración de fuentes desde la UI (P0-6) |
| 5 | Rotar y depositar el token compartido; fijar `CP_ODONTOLOGIA_M2M_URL` | PowerShell + Railway | Custodia de credenciales por organización desde la UI, con prueba de conexión (P0-6) |
| 6 | Correr la ingesta con `SOEC_INGESTA_ORG` por proceso | terminal | Scheduler multiempresa en el servidor (P0-5) |
| 7 | Auditar el sitio, detectar servicios y conversiones | Claude Chrome + lectura manual | Motor de investigación (P0-11) |
| 8 | Redactar las 4 líneas de campaña y sus keywords | Claude Code (JSON versionado) | Planner + Creative Engine con investigación real (P0-11, P0-12) |
| 9 | Crear los borradores en producción | consola del navegador contra la API | Pantalla de campañas por organización (hoy `/campanas` sólo sirve al flujo Meta demo) |
| 10 | Corregir el requisito geográfico de 4 borradores | consola del navegador (PATCH) | Regla de territorio versionada en el perfil, aplicada a los borradores |
| 11 | Escribir la regla 9/9 vs 6/9 en un módulo TS | Claude Code | Dato del perfil + validador genérico (hoy `org-cp-odontologia-google-ads.ts` es código específico **y no lo invoca el runtime**) |
| 12 | Crear la landing `/odontologia-general/` | Claude Code en otro repo | Motor de landings: detectar el hueco, especificar, publicar, medir (P1) |
| 13 | Migrar la D1 para admitir el octavo slug | wrangler + SQL | Vocabulario de eventos derivado del perfil, con migración gobernada |
| 14 | Reposicionar la web como clínica integral | Claude Code | Fuera del alcance de SOEC hoy; entraría con el motor de landings/contenido |
| 15 | Desplegar el sitio y verificar QA | wrangler + scripts | Idem |
| 16 | Diagnosticar el proxy `/api/medicion/decisiones` | Claude Code | Deuda de producto propia, no de autonomía |

**Conclusión del caso:** de 16 intervenciones, **1** era una decisión comercial legítima del propietario (qué ofrecer y con qué modalidad), **3** son acciones que ninguna API permite automatizar (autorizar OAuth, decidir el techo de inversión, confirmar afirmaciones comerciales) y **12** son trabajo que la plataforma debería hacer sola.

---

## 18. Intervención humana legítima (§3)

Sólo estas acciones deben seguir pidiendo al propietario, y siempre como **una** acción explicada en lenguaje llano: iniciar sesión y autorizar OAuth (Google, Meta), 2FA, aceptar términos de las plataformas, crear o confirmar la entidad facturable, ingresar el medio de pago, aprobar el techo máximo de inversión y sus bandas, aprobar afirmaciones comerciales o legalmente sensibles, y confirmar datos de negocio que SOEC no puede verificar (por ejemplo, qué prestaciones ofrece realmente). Todo lo demás es trabajo de la plataforma.

---

## ENTREGA

```
CURRENT_SOEC_ROLE: sistema de decisión y gobierno de campañas para UNA empresa cableada en código,
  con lectura real de Google Ads y Meta, una mutación autónoma (pausa por stop-loss), alta de campaña
  asistida por humano, y con la ingesta de datos actualmente detenida
TARGET_SOEC_ROLE: AUTONOMOUS_MARKETING_PLATFORM

ONBOARDING_AUTONOMY: 38%
RESEARCH_AUTONOMY: 31%
STRATEGY_AUTONOMY: 50%
CAMPAIGN_CREATION_AUTONOMY: 53%
MEASUREMENT_AUTONOMY: 38%
OPTIMIZATION_AUTONOMY: 46%
BUDGET_AUTONOMY: 50%
MULTIORG_AUTONOMY: 43%
UX_AUTONOMY: 44%

SOEC_AUTONOMY_READINESS: 43%   (cobertura ponderada de componentes; el recorrido extremo a extremo
                                sin desarrollador está bloqueado en 3 eslabones ⇒ efectivo ~0%)

P0_COMPLETE: 0
P0_PARTIAL: 6
P0_MISSING: 8
P1_COMPLETE: 0
P1_PARTIAL: 3
P1_MISSING: 9
P2_COMPLETE: 0
P2_PARTIAL: 2
P2_MISSING: 6

NEW_BUSINESS_REQUIRES_CODE_TODAY: YES
NEW_BUSINESS_REQUIRES_DEPLOY_TODAY: YES
GOOGLE_CAMPAIGN_CAN_BE_CREATED_AUTONOMOUSLY_TODAY: NO   (existe alta real, pero exige aprobación humana,
                                                         modo SUPERVISED_REAL y contexto org/envelope literal)
META_CAMPAIGN_CAN_BE_CREATED_AUTONOMOUSLY_TODAY: NO     (dry-run estructural; scopes de escritura prohibidos)
SOEC_CAN_OPTIMIZE_WITHOUT_OPERATOR_TODAY: NO            (sólo pausa por stop-loss, y para una sola empresa)

TOP_5_AUTONOMY_BLOCKERS:
1. El perfil del negocio vive en código: alta de empresa = módulo TypeScript + registry + deploy.
2. Los bucles operativos y la creación de campaña están fijados a org-smileflow y a un envelope literal.
3. La ingesta de datos no corre en el servidor (tarea externa deshabilitada desde 2026-08-27; CP nunca ingestó).
4. No existe motor de investigación ni generación real: la única inteligencia es determinista y los SDKs
   de proveedor están prohibidos por tests de arquitectura.
5. La optimización post-lanzamiento no ejecuta: negativas, puja, presupuesto y keywords son dry-run.

RECOMMENDED_FIRST_IMPLEMENTATION_PHASE: Fase A — «El negocio como dato»
  (perfil persistido + registro dinámico + binding identidad↔negocio, migrando las 3 empresas actuales)
CRITICAL_ARCHITECTURE_REWRITE_REQUIRED: NO

AUDIT_ONLY: YES
PRODUCTION_TOUCHED: NO
```
