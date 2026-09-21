# SOEC · La política de evaluación como dato (Autonomy Fase C)

**Fecha:** 2026-09-21 · **Afirmación que esta fase deja demostrada:** *una empresa nueva puede pasar de creada y conectada a EVALUABLE configurando sus criterios desde SOEC — sin módulo TypeScript, sin un `getProfile` propio, sin variables por tenant y sin desplegar.*

Contexto: [BUSINESS_AS_DATA.md](BUSINESS_AS_DATA.md) (el negocio) · [CONNECTIONS_AS_DATA.md](CONNECTIONS_AS_DATA.md) (las conexiones) · [RUNTIME_FOUNDATION.md](RUNTIME_FOUNDATION.md) · [../auditoria/SOEC_AUTONOMY_GAP_AUDIT.md](../auditoria/SOEC_AUTONOMY_GAP_AUDIT.md).

---

## 1. Qué entregaba `getProfile`, y dónde vive cada cosa ahora

`getProfile` existía para **una sola empresa**: SmileFlow. C Y P y CP Odontología tenían `perfil: null` y por eso no eran evaluables. Campo por campo:

| Campo del `BusinessEvaluationProfile` | Clase de dato | Dónde vive ahora |
|---|---|---|
| `organizationId` | identidad | `business_profile` (Fase A) |
| `modeloDeNegocio` | BUSINESS_FACT | derivado de `business_profile.business_type` |
| `objetivoId` | EVALUATION_POLICY | `business_evaluation_policy.objective_id` |
| `criterio.indicador` | KPI | `business_kpi.clave` (rol `PRIMARY`) |
| `criterio.lineaBase` / `meta` / `tolerancia` | KPI | `business_kpi.baseline_value` / `target_value` / `tolerance` |
| `criterio.muestraMinima` | EVIDENCE_RULE | `business_evaluation_rule` (`EVIDENCE_MINIMUM`, `IMPRESSIONS`) |
| `policy.umbralPausaTasaConversion` | EVALUATION_POLICY | `business_evaluation_rule` (`PAUSE`, `CONVERSION_RATE`) |
| `policy.umbralEscalamiento` | STRATEGY_PREFERENCE | `business_evaluation_rule` (`ESCALATION`) |
| `policy.variacionMaxPresupuesto` / `cooldownDias` | STRATEGY_PREFERENCE | `business_evaluation_policy` |
| `policy.campaniasProtegidas` / `actividadesNoModificables` | FINANCIAL_GUARDRAIL | `business_evaluation_policy` |
| `policy.escalamientoRequiereAprobacion` | FINANCIAL_GUARDRAIL | `business_evaluation_policy.scaling_requires_approval` |
| `gastoAutorizado` | FINANCIAL_GUARDRAIL | `business_evaluation_policy.authorized_spend_clp` (`null` = SOEC observa, no es autoridad) |
| `limitesAutonomia.*` | FINANCIAL_GUARDRAIL | `business_autonomy_limits` |
| `limitesAutonomia.politicaIrrelevancia` | CHANNEL_RULE | `business_autonomy_limits.irrelevance_patterns` |
| `externalResourceRefs.googleAds` | CONNECTION | `business_connection` (Fase B) |
| `cuentasExternas` | CONNECTION | `business_connection` (Fase B) |
| `directorContext.descripcion` / `vocabulario` | BUSINESS_FACT | `business_evaluation_policy` |
| `directorContext.conversionPrimaria` / `conversionesSecundarias` | KPI / evento | `business_conversion_event` |

**No se copió el objeto TypeScript a JSON.** Cada valor fue clasificado por su significado y colocado en la tabla que le corresponde; por eso un umbral de pausa es una *regla* y no una columna, y el embudo es una *lista de eventos* y no dos campos de texto.

## 2. Cuatro clases que no se mezclan

```
FACT             lo que el negocio ES            business_profile · business_offering · business_geo_scope
POLICY           lo que QUIERE y qué es bueno    business_evaluation_policy · business_kpi · business_evaluation_rule
OBSERVED_METRIC  lo que de hecho pasó            event store · snapshots  ← nunca en estas tablas
DECISION         lo que se resolvió hacer        ledger de decisiones y mandatos
```

Hay una prueba que lo verifica sobre el propio SQL: el esquema de la política no contiene ninguna columna de métrica observada ni ningún permiso (`external_mutations`, `autonomous_spend`, `campaign_execution`, `automatic_safety_pause`).

## 3. Lo que NO se duplicó

El territorio sigue en `business_geo_scope`, los productos y sus prioridades en `business_offering`, las restricciones y claims en `business_restriction`, el permiso de mutar o gastar en `business_governance`, las cuentas en `business_connection`. La política los **referencia**: `GET /politica` los devuelve bajo `referencias`, y la edición de prioridades o de límites comerciales escribe **en su tabla canónica**. Ninguna copia: cambiar el territorio en dos sitios es cómo se pierde la verdad.

## 4. Los KPI son datos (y sirven a cualquier industria)

Un KPI se describe por su **forma**, no por su nombre: `tipo` (`EVENT_COUNT`, `RATE`, `COST_PER`, `VALUE`, `RATIO`), `unidad`, `direccion` (`HIGHER_IS_BETTER` / `LOWER_IS_BETTER`), `event_key`, `target_value`, `baseline_value`, `tolerance`, `estado`. Con eso caben, sin una sola rama por industria y probado en test:

| Negocio | Evento | Indicador | Forma |
|---|---|---|---|
| Clínica | `whatsapp_intent` | contactos conseguidos | `EVENT_COUNT` · `COUNT` · más es mejor |
| Clínica | `phone_intent` | costo por contacto | `COST_PER` · `CURRENCY` · **menos es mejor** |
| SaaS | `demo_requested` | demos solicitadas | `EVENT_COUNT` · `COUNT` |
| E-commerce | `purchase` | ROAS | `RATIO` · `RATIO` |

`estado` distingue **configurado** de **desconocido**: un indicador sin meta queda `UNKNOWN` y **no** cuenta como configurado — una meta invisible no es una meta.

## 5. Criterios de evidencia

`business_evaluation_rule` con tipo `EVIDENCE_MINIMUM` admite `IMPRESSIONS`, `CLICKS`, `CONVERSIONS`, `SPEND` y `OBSERVATION_WINDOW_DAYS`. Cada mínimo concreto puede quedar `NOT_APPLICABLE` según el canal, pero **al menos uno configurado es requisito** para ser evaluable: sin un piso declarado, el Director podría dar por bueno —o por malo— un resultado con un puñado de datos. A las empresas históricas no se les inventó ninguno: SmileFlow traía 1.000 impresiones documentadas y ése es el valor migrado; CP no traía ninguno y por eso figura entre lo que le falta.

## 6. Completitud con motivos estructurados

`EVALUATION_PROFILE_COMPLETE` exige cinco cosas; cualquier ausencia se informa con su campo, su motivo y **cómo se resuelve**:

| Campo | Qué falta |
|---|---|
| `primaryObjective` | el negocio no tiene objetivo de evaluación declarado |
| `primaryConversionEvent` | no se declaró qué acción de un cliente cuenta como resultado |
| `primaryKpi` | no hay indicador principal configurado |
| `successCriterion` | no hay meta ni umbral de éxito |
| `evidenceMinimum` | no se declaró cuántos datos hacen falta antes de concluir |

Además hay **recomendaciones** que no bloquean: objetivo en lenguaje de negocio, umbral de pausa, horizonte, indicador secundario, reglas de canal, territorio y prioridades de oferta.

## 7. Frontera con el gobierno

```
Evaluation Policy → Decision → Capability → Operating Mode → Financial Mandate → Kill Switch → Executor
```

«A esta campaña le va mal» y «SOEC puede modificarla» son dos afirmaciones distintas y viven en sitios distintos. Completar la política **no** enciende `externalMutations`, `autonomousSpend` ni `campaignExecution` — hay un test que lo comprueba tras completar la política de la empresa QA— y `MONITOR_SEGURIDAD` sigue necesitando `automatic_safety_pause` para pausar de verdad.

## 8. Resolución en runtime

La proyección que ya alimentaba al resolutor (Fase B) ahora arma el `BusinessEvaluationProfile` **desde la política persistida**:

```
business_profile + business_evaluation_policy + business_kpi + business_conversion_event
+ business_evaluation_rule + business_autonomy_limits + business_connection
      │  construirPerfilDeEvaluacion()   ← pura; null si la política está incompleta
      ▼
fijarNegociosDelRuntime → getProfile · buscarProfile · getRecursoGoogleAds · getEmbudo · bindExperienciaReal
```

- Con política **completa** → perfil desde datos. El módulo histórico **no se consulta**.
- Con política **incompleta** y empresa migrada → respaldo del módulo, **contado** en la telemetría (`camposDelRegistro: ['perfilDeEvaluacion']`).
- Con política incompleta y empresa **nueva** → `perfil = null` y `409 PROFILE_INCOMPLETE` **con los campos que faltan**.

**Paridad probada:** el perfil de SmileFlow reconstruido desde PostgreSQL es `toEqual` idéntico al de `CONFIGURACION_ORG_SMILEFLOW.perfil` — mismo objetivo, criterio, política de optimización, gasto autorizado (`null`), límites de autonomía, cuentas externas y contexto del director. Esa igualdad es la garantía de que no cambió la semántica de nada.

## 9. El Director

El ciclo del Director recibe una **puerta de entrada**: capacidad `CICLO_DIRECTOR` habilitada (Fase B) **y** política completa. Si falta política, el tick registra `{ directorCycle: 'skip', motivo: 'PROFILE_INCOMPLETE', faltantes: [...] }` y sigue — no es un error de servidor y un tenant incompleto no bloquea a los demás. Si la comprobación misma falla, el ciclo se deja correr: quien ya venía funcionando no se apaga por un problema de observabilidad.

## 10. Migración de las tres empresas

`migrarPoliticasDelRegistro` corre en cada arranque, es idempotente y **nunca sobrescribe** lo que una persona editó.

| Empresa | Qué se migró | Estado |
|---|---|---|
| SmileFlow | objetivo, KPI (`tasa_conversion`, meta 0,03, línea base 0, tolerancia 0,2), evidencia (1.000 impresiones), pausa (0,005), escalamiento (0,05), variación 0,2, cooldown 1 día, aprobación obligatoria, límites (2.000 CLP/día, CPC 1.000, 15 %, 2 cambios/día, 72 h, 30 impresiones), canal `google_ads`, contexto y vocabulario | **COMPLETE** |
| CP Odontología | objetivo declarado (`captar pacientes / evaluaciones odontológicas`, ya en `business_profile`) y su embudo real (`whatsapp_intent` + `appointment_intent`, `phone_intent`) | **INCOMPLETE** — falta indicador, meta y mínimo de evidencia |
| Distribuidora C Y P | nada: no tiene política. **No se crea ninguna fila** | **INCOMPLETE** — faltan los cinco |

Ninguna empresa recibió un objetivo, una meta ni un umbral que nadie hubiera fijado. Quedar `INCOMPLETE` es el resultado correcto cuando la información no existe.

## 11. CP como caso de prueba

Lo que CP ya tiene persistido alcanza para representar su realidad sin inventar nada: **clínica odontológica** (tipo de negocio), **captar pacientes/evaluaciones** (objetivo), **rehabilitación oral** como oferta prioritaria y **odontología general** como oferta válida (`business_offering`, prioridades 10 y 50), **Provincia de Curicó** como territorio comercial (`business_geo_scope`, ámbito `BUSINESS`), y **WhatsApp / llamada** como contactos relevantes (eventos del embudo).

Sobre **Fonasa**: el modelo lo representa como `PROHIBITED_CLAIM` en `business_restriction` y la prueba demuestra el camino completo (añadirlo desde la API y verlo en las referencias de la política). No se insertó ninguna fila en producción: hoy SOEC no guarda ese claim —vive en el sitio de CP y en las negativas de sus borradores de campaña— y crearlo es una decisión del propietario desde la interfaz, no un efecto de esta migración.

## 12. Interfaz

`/negocios/objetivos` — «Objetivos y criterios». Pregunta, en este orden: qué quieres conseguir · qué acción de un cliente consideras importante · con qué lo medimos · cuál es tu meta · cuáles son tus servicios prioritarios · qué límites no deben violarse nunca. Arriba, una lista de pendientes con **cómo se resuelve cada uno**.

Lo técnico vive en **Configuración avanzada**: horizonte, mínimo de evidencia (con una sugerencia que el usuario puede cambiar) y umbral de pausa. La página dice explícitamente que definir esto **no autoriza gastar dinero ni cambiar campañas**. Nunca se le exige al usuario saber qué es CPA, ROAS o CVR: elige «cuánto te cuesta cada contacto» y el sistema traduce.

## 13. Tenencia

Todo va por el gateway: la organización es la del **contexto autenticado**, nunca la de la URL ni la del cuerpo. Leer exige contexto; editar exige `business.manage`. Probado: una empresa no lee, no edita y no evalúa la política de otra, y sin sesión no hay nada.

## 14. Auditoría

`EVALUATION_POLICY_CREATED`, `EVALUATION_POLICY_UPDATED`, `EVALUATION_PROFILE_COMPLETED` y `EVALUATION_PROFILE_BECAME_INCOMPLETE`, con actor, organización, campos tocados y timestamp. Las transiciones de completitud se registran porque son el hecho que importa: el momento en que un negocio empieza —o deja— de ser evaluable.

## 15. Salud

`GET /operacion/salud` incluye `evaluationProfile: { status, missingFields, recommendations, lastUpdatedAt }`. Responde, sin leer logs, la pregunta «¿por qué esta empresa no entra al Director?».

## 16. Qué queda

Una empresa nueva ya se incorpora, se conecta y define sus criterios sola. Sigue sin haber onboarding inteligente, investigación, generación creativa ni creación de campañas: **SOEC ya puede evaluar a cualquier empresa; todavía no puede promocionarla sola.**

El registro TypeScript se conserva como referencia y rollback, no como dependencia operativa: para las empresas con política completa no se consulta, y la telemetría (`GET /conexiones/procedencia`) lo demuestra con números.
