# SOEC · Conversión y ejecución de campañas (Autonomy Fase F)

**Fecha:** 2026-09-22 · **Afirmación que esta fase deja demostrada:** *una empresa elegible pasa de un plan versionado a una campaña REAL creada por SOEC en su cuenta de Google — sin Claude, sin Chrome manual, sin la interfaz de Google, sin código por empresa y sin desplegar — y esa campaña nace **en pausa**, con gasto externo cero.*

Las tres frases que gobiernan todo el módulo:

> **CREAR ≠ ACTIVAR · PLAN ≠ AUTORIZACIÓN · PROPUESTA DE PRESUPUESTO ≠ MANDATO DE GASTO**

Contexto: [BUSINESS_AS_DATA.md](BUSINESS_AS_DATA.md) · [CONNECTIONS_AS_DATA.md](CONNECTIONS_AS_DATA.md) · [EVALUATION_POLICY_AS_DATA.md](EVALUATION_POLICY_AS_DATA.md) · [INTELLIGENT_BUSINESS_ONBOARDING.md](INTELLIGENT_BUSINESS_ONBOARDING.md) · [AUTONOMOUS_RESEARCH_AND_CAMPAIGN_PLANNING.md](AUTONOMOUS_RESEARCH_AND_CAMPAIGN_PLANNING.md).

---

## 1. Qué se reutilizó (y por qué no hay un segundo ejecutor)

El camino que ya podía crear una campaña real —el que creó la campaña de SmileFlow— **no se duplicó: se generalizó**.

| Pieza existente | Qué hace | Qué cambió en esta fase |
| --- | --- | --- |
| `google-ads-materializer.ts` | construye UNA request atómica de `GoogleAdsService.Mutate` | se añadió `materializarPaqueteGoogleAds()`, la entrada **multiempresa**; el camino por-plan histórico sigue en el mismo módulo |
| `GoogleAdsMutateHttpClient` | transporte con allowlist de host, parseo de errores y request-id | se añadió `crearAccionDeConversion()` (sólo conversiones) |
| `accion/mandato.ts` | mandato financiero humano, tope duro en enteros | se usa tal cual como requisito `FINANCIAL_MANDATE_VALID` |
| `gobierno/kill-switch.ts` | interruptor de mutaciones externas del despliegue | se comprueba antes de construir siquiera el cliente |
| Modo operativo (identidad) | `PILOT` / `SUPERVISED_REAL` / `AUTONOMOUS_REAL` | esta fase ejecuta **sólo** supervisada |
| Capacidades (Fase B) | permisos por empresa sobre sus conexiones | nueva capacidad `ESCRITURA_ADS` (`GOOGLE_ADS_WRITE`), apagada para todos |

**El estado por defecto del materializador pasó de `ENABLED` a `PAUSED`.** Antes, crear una campaña la dejaba encendida salvo que el llamador dijese lo contrario; ahora encenderla exige pedirlo explícitamente, y ningún llamador lo pide.

## 2. La petición de ejecución es una entidad

```
DRAFT ──requisitos──▶ BLOCKED ──se resuelve lo que falta──▶ READY ──aprobación humana──▶ READY(firmada)
                                                                    │
                                                          ejecutar  ▼
                                              EXECUTING ──▶ CREATED_PAUSED ✓
                                                      ├──▶ PARTIAL   (hay checkpoint; se reanuda sin duplicar)
                                                      └──▶ FAILED    (nada quedó creado)
                          CANCELLED ◀── la persona la retira antes de ejecutar
```

`campaign_execution_request` guarda: organización, plan y versión, actor, fecha, **el paquete congelado**, la foto de los requisitos, la firma de la autorización, los identificadores externos creados, la reconciliación y el motivo. Un índice único sobre `(organización, hash del paquete)` para peticiones vivas hace la idempotencia **estructural**: el mismo paquete no puede tener dos peticiones, y por tanto no puede crear dos campañas.

## 3. El paquete congelado

El paquete (`paquete.ts`) es la fotografía de lo que se va a crear: cuenta, nombre de campaña, presupuesto diario en micros, puja, geotargets reales, idioma, grupos con sus palabras y concordancias, anuncios aprobados, negativas con su motivo, conversiones y `estadoInicial: 'PAUSED'` —un literal en el tipo, no una opción.

Su **hash** excluye la fecha y el propio hash: dos paquetes materialmente idénticos comparten identidad. Si después cambia la oferta, la investigación, la geografía, el presupuesto, el landing, las palabras, los anuncios o la política, el hash deja de coincidir y la ejecución se detiene pidiendo **preparar de nuevo**. Una petición aprobada nunca muta en silencio.

## 4. Los doce requisitos

`PLAN_CURRENT` · `BUSINESS_READY` · `CONNECTION_VALID` · `ACCOUNT_SELECTED` · `GEO_EXECUTABLE` · `LANDING_READY` · `CONVERSION_READY` · `CREATIVE_READY` · `FINANCIAL_MANDATE_VALID` · `WRITE_CAPABILITY_ENABLED` · `OPERATING_MODE_ALLOWED` · `KILL_SWITCH_ALLOWED`

Cada uno con veredicto `PASS` / `BLOCKED` / `ACTION_REQUIRED` / `NOT_APPLICABLE` y su motivo en lenguaje de negocio. Se evalúan **todos**, siempre, y se devuelven todos.

* `ACTION_REQUIRED` lo resuelve la persona desde SOEC (escribir anuncios, firmar el presupuesto, instalar la medición).
* `BLOCKED` es una puerta de gobierno que no se abre desde una pantalla de marketing (interruptor del despliegue, conflicto de afirmaciones, modo autónomo).
* **Si falla uno obligatorio no se intenta crear nada**, ni una parte: una campaña a medias en la cuenta de un cliente hay que ir a limpiarla a mano.

El gate se reevalúa **otra vez** justo antes de escribir, con los datos de ese momento: una aprobación de ayer no autoriza el mundo de hoy.

## 5. Conversiones: cuatro cosas distintas

| Concepto | Dónde vive |
| --- | --- |
| **Evento interno** — qué cuenta como resultado | `business_conversion_event` (Fase C) |
| **Acción externa** — el objeto en la plataforma | `conversion_action_mapping` |
| **Medición instalada** — el sitio la dispara | `tracking_state` |
| **Medición verificada** — llegó de verdad | `tracking_state` + señal observada |

Estados: `ACTION_MISSING` → `ACTION_CREATED` → `TRACKING_MISSING` → `TRACKING_INSTALLED` → `VERIFIED` (o `DEGRADED`). **Sólo `VERIFIED` habilita ejecutar.** Que la acción exista en Google no es medición funcionando; confundirlo es cómo se acaba con campañas «optimizando a conversiones» que nunca registraron ninguna.

**Idempotencia:** la identidad es `(organización + proveedor + evento)` y el nombre externo es estable (`SOEC · <empresa> · <evento>`). Antes de crear se mira el mapeo persistido y luego la plataforma; si ya existe allá, **se adopta**. No hay forma de acabar con «WhatsApp CP 2» y «WhatsApp CP 3».

**Traducción sin jerga:** el onboarding dice «me contactan por WhatsApp» y el ejecutor traduce a `category=CONTACT`, `type=WEBPAGE`, `countingType=ONE_PER_CLICK`. El usuario nunca escribe un enum ni una etiqueta de conversión.

## 6. Instalación de la medición

`TrackingDeploymentProvider` es el puerto que sustituye al patrón «un desarrollador edita a mano la web de cada empresa». En este despliegue:

* **no hay** una vía automática y segura de escribir en el sitio de un cliente ⇒ el proveedor por defecto entrega **instrucciones y el fragmento exacto** (sin secretos) y deja el estado en `TRACKING_MISSING`;
* la **verificación** sí es automática: se busca la señal observada por SOEC. Sin señal, `VERIFIED` no se concede — no se finge.

## 7. El ejecutor de Google

Una sola llamada atómica (`partialFailure=false`) crea presupuesto → campaña → grupos → anuncios → palabras → negativas → geografía → idioma. Si Google rechaza una operación, **no queda nada**.

**Dos puertas de pausa:** la campaña nace `PAUSED` y sus grupos también. Encenderla más adelante exigirá abrir las dos a propósito.

**Idempotencia real:** antes de escribir se pregunta a la plataforma si ya existe una campaña con ese nombre. Si existe, se **adopta** (cero escrituras). Si el libro dice que se creó y la plataforma no la tiene, **no se recrea a ciegas**: se marca `PARTIAL` y se pide revisión.

**Verificación:** después de crear se lee de vuelta campaña, presupuesto, grupos, palabras, negativas, geografía y anuncios. `CREATED_PAUSED` sólo se declara si la reconciliación mínima pasa —la campaña existe y está en pausa—; las divergencias se guardan.

**Deriva (drift):** volver a reconciliar más tarde detecta lo que alguien cambió por fuera. **No se sobrescribe**: se muestra la diferencia y se deja la decisión a una persona.

## 8. Dinero

| Cifra | De dónde sale |
| --- | --- |
| Oportunidad de mercado | derivada de la demanda observada (Fase E) |
| Presupuesto propuesto | el techo que declaró el dueño (Fase D/E) |
| **Mandato autorizado** | `accion_mandato`: tope duro, firmado por una persona, en enteros |
| Presupuesto de la campaña en Google | **el MENOR entre el propuesto y el que permite el mandato** |

Sin mandato vigente no se congela paquete y no se ejecuta — aunque la campaña vaya a nacer pausada, porque se está materializando una configuración de gasto futura. El mandato queda dentro del paquete: se puede auditar sin buscar en otra tabla.

## 9. Afirmaciones

Antes de materializar cualquier texto se validan titulares, descripciones, enlaces y destacados contra lo que la empresa declaró (`PROHIBITED_CLAIM`, `RESTRICTION`), con una excepción deliberada: una afirmación **aprobada** explícitamente gana sobre la coincidencia léxica con una restricción. Un conflicto deja `CREATIVE_READY = BLOCKED`. **No se publica primero y se revisa después.**

## 10. Autorización de escritura

Crear un recurso externo exige, en este orden y todos a la vez:

```
interruptor del despliegue  →  conexión CONNECTED con cuenta declarada  →  capacidad ESCRITURA_ADS
   →  postura de gobierno de la empresa (externalMutations + campaignExecution)
   →  modo SUPERVISED_REAL  →  mandato financiero vigente  →  aprobación humana de ESTA petición
```

`plan.status = READY` **no** autoriza nada. La aprobación guarda actor, fecha, versión del plan, acción autorizada y foto del mandato.

**`AUTONOMOUS_REAL` no crea campañas en esta fase**, aunque el modo exista: primero se prueba el camino supervisado. La autonomía futura reutilizará exactamente este ejecutor.

## 11. Libro de ejecución y recuperación

`campaign_execution_step` registra `CONVERSION_LOOKUP` · `CONVERSION_CREATE` · `BUDGET_CREATE` · `CAMPAIGN_CREATE` · `TARGETING_APPLY` · `AD_GROUP_CREATE` · `KEYWORD_CREATE` · `NEGATIVE_CREATE` · `AD_CREATE` · `ASSET_CREATE` · `VERIFY_REMOTE_STATE`, cada uno con su clave de idempotencia, su identificador externo, el request-id del proveedor y su resultado. Nunca tokens.

Si el proceso muere después de que Google creara todo, el siguiente intento lo **adopta**. Ningún recurso externo se borra automáticamente.

## 12. Meta

**`META_EXECUTOR = BLOCKED_EXTERNAL`.** El camino de escritura existe (`meta-write-port`, adapter real tras master switch, reconciliación), pero el permiso que necesita —`ads_management`— está en la lista de **scopes prohibidos** del OAuth de SOEC, que es una integración de sólo lectura revisada como tal. Sin ese permiso concedido por Meta no hay escritura posible, y no se finge paridad con Google.

## 13. Qué queda demostrado por prueba

`apps/api/test/campaign-execution.test.ts` (56 casos deterministas) y `campaign-execution.pg.test.ts` (12 casos sobre PostgreSQL real, por las mismas APIs que usa la interfaz, con un Google simulado):

* la campaña y sus grupos se materializan **siempre** en pausa, y la prueba de arquitectura falla si aparece `ENABLED`;
* el presupuesto nunca supera el mandato; sin mandato no hay paquete;
* un texto que contradice lo declarado bloquea antes de crear nada;
* **reintentar no duplica**: se adopta lo que existe, con cero escrituras;
* una caída a mitad se reanuda adoptando, no recreando;
* un rechazo de la plataforma no deja recursos a medias;
* plan viejo, mandato vencido, medición sin verificar, sin permiso de escritura e interruptor cerrado bloquean;
* una empresa no prepara, no autoriza y no ejecuta la campaña de otra.

## 14. Lo que esta fase NO hace

No enciende campañas · no activa nada automáticamente · no cambia presupuestos por su cuenta · no optimiza pujas ni palabras · no añade negativas automáticas desde términos de búsqueda · no rota creatividades · no genera anuncios con IA · no crea landing pages · no escribe en Meta.
