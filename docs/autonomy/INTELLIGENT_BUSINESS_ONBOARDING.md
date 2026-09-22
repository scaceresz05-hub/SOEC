# SOEC · Onboarding inteligente de negocios (Autonomy Fase D)

**Fecha:** 2026-09-21 · **Afirmación que esta fase deja demostrada:** *una persona que no sabe marketing digital incorpora y prepara su empresa contestando preguntas en lenguaje de negocio — sin Claude, sin desarrollador, sin TypeScript, sin SQL, sin Railway, sin terminal, sin variables por empresa y sin desplegar.*

El principio del producto, escrito una vez y respetado en todo el módulo:

> **El usuario habla de su negocio. SOEC traduce eso a configuración de marketing.**

Contexto: [BUSINESS_AS_DATA.md](BUSINESS_AS_DATA.md) · [CONNECTIONS_AS_DATA.md](CONNECTIONS_AS_DATA.md) · [EVALUATION_POLICY_AS_DATA.md](EVALUATION_POLICY_AS_DATA.md) · [RUNTIME_FOUNDATION.md](RUNTIME_FOUNDATION.md) · [../auditoria/SOEC_AUTONOMY_GAP_AUDIT.md](../auditoria/SOEC_AUTONOMY_GAP_AUDIT.md).

---

## 1. Máquina de estados

```
NOT_STARTED ──primera respuesta──▶ IN_PROGRESS ──todo respondido + falta un acto tuyo──▶ NEEDS_ACTION
                                        │                                                     │
                                        └────────todo respondido y negocio entendido──────────┴──▶ COMPLETE
                                                                                                     │
                                                                              reabrir para corregir ─┘
```

`NEEDS_ACTION` va **antes** que `COMPLETE`: si la persona ya respondió todo y lo que falta es un acto suyo —conectar una cuenta—, decir «completo» sería mentir sobre el estado de su empresa. Al llegar a `COMPLETE` el negocio pasa de `DRAFT` a `READY`; eso **no** enciende ningún permiso.

El estado vive en `business_onboarding` (paso actual, pasos resueltos, marcas de inicio/fin/reapertura) y las respuestas en `business_onboarding_answer`. Cerrar el navegador, o salir a un OAuth y volver, no pierde nada.

## 2. Modelo de preguntas

Una pregunta es `{ id, etiqueta, ayuda, tipo, opciones, requerida, aplica, yaSabemos }`, y vive en un catálogo declarativo (`onboarding-preguntas.ts`, función pura). El servidor devuelve **la conversación ya resuelta**; la interfaz sólo pinta. Así las ramas se prueban una vez donde viven y la conversación puede mejorar sin tocar el front.

Tipos de respuesta: `TEXTO`, `TEXTO_LARGO`, `OPCION`, `OPCIONES`, `NUMERO`, `SI_NO`, `LISTA_TEXTO`. Ninguno expone jerga: son formas de contestar.

**Prohibido en las preguntas** —y verificado por prueba sobre los textos reales— el vocabulario `CPC`, `CPA`, `ROAS`, `CVR`, `MCC`, `pixel`, `conversion label`, `attribution`, `bidding`, `match type`, `capability`, `governance`, `scheduler`.

Once pasos: **tu empresa · qué vendes · dónde atiendes · qué quieres conseguir · cómo te contactan · lo que no debemos decir · cómo sabremos si funciona · de dónde salen los datos · cuánto invertirías · cuánto quieres que SOEC decida · lo que SOEC entendió**.

## 3. Ramas condicionales

La siguiente pregunta depende de las respuestas anteriores, y las ramas se expresan por **tipo de negocio**, nunca por rubro. «Odontología» no existe como arquitectura: existe `CLINICA`, igual que `ECOMMERCE`, `SAAS`, `LOCAL`, `SERVICIOS` u `OTRO`.

| Tipo | Preguntas propias | Lo que NO se le pregunta |
|---|---|---|
| `ECOMMERCE` | se puede comprar en el sitio · hasta dónde despachas | modalidad de prueba de software |
| `CLINICA` / `LOCAL` / `SERVICIOS` | comunas atendidas · agenda o reserva de horas | despacho |
| `SAAS` | cómo se prueba antes de pagar · países donde vende | comunas |

La rama responde al **último** valor: si alguien cambia su tipo de negocio dentro del asistente, las preguntas cambian en el acto (probado).

La integración técnica del propio sistema (envío de eventos máquina a máquina) **sólo se ofrece a quien puede tenerla**: e-commerce, software o quien ya tenga esa conexión. A una peluquería no se le pregunta por M2M.

## 4. No se pregunta lo que SOEC ya sabe

Antes de formular una pregunta se consulta lo persistido. Si el dato existe, se muestra **resuelto y con su procedencia** para confirmar o corregir:

- país, moneda, tipo de negocio y tipo de cliente → del perfil (`USER`);
- «¿haces publicidad en Google?» → si ya está conectado, llega respondido (`CONNECTOR`) y la interfaz muestra «Ya está conectado ✓»;
- la oferta, el territorio, el objetivo y las conversiones ya persistidas → precargados para confirmar, no para reconstruir.

## 5. Procedencia

Cada dato recogido lleva `USER`, `WEBSITE`, `CONNECTOR` o `DERIVED`, y un estado de verificación `DISCOVERED` / `USER_CONFIRMED`.

**Regla dura: sólo lo `USER_CONFIRMED` se escribe en el negocio.** Lo que se leyó del sitio web se guarda como propuesta y se muestra con «esto lo leímos de tu sitio; revísalo», pero no entra al perfil hasta que la persona lo confirma (probado: un sitio inaccesible o un texto descubierto no dejan nada escrito en `business_profile`).

## 6. Lectura del propio sitio

Una **sola** lectura de la portada del sitio que el dueño escribió, para no pedirle lo que está a la vista: título, descripción y rutas internas. No es un motor de investigación: no visita competidores, no rastrea el sitio entero y no lee nada de terceros.

Defensas (una petición a un host que escribe un usuario es superficie de ataque):

- sólo `https`, sólo el puerto por defecto, sin credenciales en la URL, dominio con punto;
- el host debe **resolver a una IP pública**: se rechazan loopback, privadas, CGNAT, link-local y `169.254.169.254` (metadatos de nube) — y no se hace la petición;
- redirecciones sólo dentro del **mismo dominio registrable**, máximo dos saltos;
- tiempo máximo de espera y tamaño máximo de lectura acotados; el cuerpo no se guarda;
- un sitio caído es **información del onboarding** (`UNREACHABLE`), no un error del sistema.

## 7. A dónde va cada respuesta (SSOT)

| Paso | Respuesta | Tabla canónica |
|---|---|---|
| tu empresa | a qué se dedica · tipo · a quién vende · sitio · país | `business_profile` |
| qué vendes | «hacemos implantes, prótesis y odontología general» | `business_offering` (tres filas, slugs derivados) |
| qué vendes | cuáles potenciar | `business_offering.priority` |
| dónde atiendes | comunas · región | `business_geo_scope` (ámbito `BUSINESS`) |
| qué quieres conseguir | objetivo · en cuántos días | `business_profile.primary_objective` + `business_evaluation_policy` |
| cómo te contactan | acciones y la más importante | `business_conversion_event` (`PRIMARY` / `SECONDARY`) |
| lo que no debemos decir | no ofrecemos… / no podemos afirmar… | `business_restriction` (`RESTRICTION` / `PROHIBITED_CLAIM`) |
| cómo sabremos si funciona | indicador · meta · evidencia | `business_kpi` + `business_evaluation_rule` |
| cuánto invertirías | modalidad y monto | `business_budget_intent` + `business_autonomy_limits` |
| cuánto decide SOEC | preferencia | modo operativo de identidad (vía gobernada) |

El usuario no escribe slugs, códigos ni taxonomías. «hacemos implantes, prótesis y odontología general» se trocea en tres elementos y se les quita el arranque de frase: un implante no se llama «hacemos implantes».

Corregir una respuesta **actualiza** el dato: reescribir la lista de servicios retira (no borra) los que ya no se mencionan, y cambiar el objetivo actualiza perfil y política sin reconstruir la empresa ni cambiar su identidad (probado).

## 8. Nada se inventa

- **Metas:** si el dueño no sabe qué número sería bueno, el indicador se guarda sin meta, en estado `UNKNOWN` y con procedencia **`TO_BE_LEARNED`**. La preparación lo explica como «se aprenderá observando los primeros datos», no como un descuido. Ese marcador es el que usará después el motor de experimentación.
- **Mínimos de evidencia:** se ofrece un punto de partida **del sistema**, versionado y con fundamento escrito (`IMPRESSIONS = 1000`, `v1`: a un CTR observado ~2,5 % equivale a ~25 clics), guardado con procedencia `SYSTEM_DEFAULT`. Quien quiera define el suyo (`USER_DEFINED`). Donde no hay fundamento interno, el valor queda `UNCONFIGURED` y se dice.
- Las procedencias de política viven en `business_kpi.procedencia` y `business_evaluation_rule.procedencia`: `USER_DEFINED · SYSTEM_DEFAULT · LEARNED · MIGRATED · TO_BE_LEARNED · UNCONFIGURED`.

## 9. Conexiones

El asistente presenta **Google**, **Meta** y **los datos de tu sitio**; nunca «provider adapters», «secret refs» ni «scheduler eligibility». Conectar sigue siendo un acto aparte (el OAuth que ya existía): el asistente pregunta si usa cada plataforma, muestra lo ya conectado y lleva a terminarlo. Si la persona sale al OAuth y vuelve, el asistente sigue donde estaba.

## 10. Capacidades derivadas

Lo que el sistema enciende **solo**, y únicamente cuando una conexión válida lo sostiene:

| Capacidad | Cuándo | Por qué es segura |
|---|---|---|
| `INGESTA_GROWTH` | el sitio del negocio está conectado | lectura de los eventos del propio sitio |
| `MEDICION_REAL` | hay al menos una fuente conectada | lectura de datos reales |

Lo que **nunca** se deriva: `CICLO_DIRECTOR` y `MONITOR_SEGURIDAD` (consumen cuota y el segundo toca el camino de seguridad), `AUTONOMIA_ADS`, cualquier escritura externa y el gasto autónomo. Se usa `fijarCapacidadSiFalta`: si una persona ya apagó algo, sigue apagado.

## 11. Techo de inversión

Se pregunta en lenguaje comercial —«¿cuánto como máximo estarías dispuesto a invertir?»— con cuatro respuestas legítimas: *todavía no quiero invertir*, *un máximo por día*, *un máximo por mes*, *prefiero decidirlo después*.

**Tres conceptos distintos, tres hogares distintos:**

| Concepto | Dónde vive | Qué significa |
|---|---|---|
| intención declarada | `business_budget_intent` | lo que el dueño dijo; incluye «todavía no» |
| tope operativo duro | `business_autonomy_limits.max_daily_budget_clp` | lo que SOEC no puede pasar por día |
| autorización financiera | `accion_mandato` | permiso humano de gastar hasta X en un período |

**Guardar un techo no es autorizar gasto.** El asistente **no crea ningún mandato**: eso lo hace una persona en un acto explícito y aparte. Probado: tras completar el asistente con un máximo diario declarado, `accion_mandato` sigue vacío.

## 12. Nivel de autonomía

Tres respuestas en lenguaje humano, mapeadas al modo operativo por la **vía gobernada** de identidad (con su permiso `operational_mode.manage`, su política y su auditoría):

| Respuesta | Modo | Disponible |
|---|---|---|
| solo observar y avisarme | `PILOT` (= OBSERVE) | sí — **valor por defecto** |
| pedirme aprobación antes de hacer cambios | `SUPERVISED_REAL` | sí |
| operar automáticamente dentro de mis límites | `AUTONOMOUS_REAL` | **no** en esta versión: el dominio lo rechaza |

Cuando el nivel pedido no se puede aplicar, el asistente devuelve un **aviso** con el motivo real y la interfaz
lo muestra arriba («pediste operar automáticamente y no se pudo aplicar: …; el nivel sigue siendo el anterior»).
No se deja a nadie suponiendo que quedó activado.

## 13. Readiness

Un read model canónico, `BusinessReadiness`, con **dominios** y **niveles** — nunca un «100 % completo».

Diez dominios, cada uno `COMPLETE · INCOMPLETE · OPTIONAL · ACTION_REQUIRED` con motivos estructurados: `BUSINESS_PROFILE`, `OFFER`, `GEOGRAPHY`, `OBJECTIVE`, `CONVERSIONS`, `RESTRICTIONS`, `EVALUATION`, `CONNECTIONS`, `FINANCIAL_MANDATE`, `GOVERNANCE`. `ACTION_REQUIRED` es lo que no resuelve una respuesta sino un acto (conectar una cuenta, autorizar dinero).

Cinco niveles independientes:

| Nivel | Exige |
|---|---|
| `BUSINESS_READY` | perfil + oferta + territorio + objetivo |
| `MEASUREMENT_READY` | + conversión principal + una conexión + capacidad de lectura |
| `CAMPAIGN_PLANNING_READY` | + política de evaluación completa + límites revisados |
| `CAMPAIGN_EXECUTION_READY` | + cuenta de publicidad + techo declarado + permiso de gobierno + modo ≥ supervisado + **autorización financiera humana** |
| `AUTONOMY_READY` | + gasto autónomo + modo automático (hoy no disponible) |

Que `BUSINESS_READY = sí` y `CAMPAIGN_EXECUTION_READY = no` es una respuesta **correcta**, no un error. Y ejecutar campañas **nunca** queda listo por rellenar un formulario: siempre falta, al menos, una autorización de presupuesto firmada por una persona.

## 14. Superficie HTTP

| Ruta | Autoridad | Qué hace |
|---|---|---|
| `GET /onboarding` | gateway | conversación resuelta + progreso + readiness + resumen |
| `GET /onboarding/readiness` | gateway | sólo el read model de preparación |
| `PATCH /onboarding` | gateway + `business.manage` | guarda un paso, lo traduce y recalcula |
| `POST /onboarding/sitio` | gateway + `business.manage` | lectura única de la portada (propuesta) |
| `POST /onboarding/completar` | gateway + `business.manage` | termina, o dice qué falta |
| `POST /onboarding/reabrir` | gateway + `business.manage` | vuelve a abrirlo para corregir |

La organización es la del **contexto autenticado**, nunca la de la URL. Probado: una empresa no lee, no modifica y no completa el onboarding de otra, y sin sesión no hay nada.

## 15. Interfaz

`/negocios/onboarding` — «Cuéntanos de tu negocio». Barra de progreso, **Atrás**, **Continuar**, **Guardar y salir**, y guardado automático mientras se escribe (1,8 s de reposo). Una columna, campos a 16 px y objetivos táctiles grandes: funciona igual en teléfono y en escritorio. Sin JSON, sin códigos internos, sin terminología de ingeniería.

La pantalla final muestra **lo que SOEC entendió** (empresa, oferta, objetivo, territorio, conversiones, restricciones, conexiones, techo, autonomía), qué está listo por dominios y hasta dónde puede llegar SOEC hoy, con `LISTO` / `FALTA INFORMACIÓN` / `REQUIERE TU ACCIÓN`. Y dice, en la propia pantalla, que terminar no gasta dinero ni cambia campañas.

Crear una empresa lleva directamente al asistente: mandar a alguien que acaba de dar de alta su empresa a un panel vacío sería un callejón.

## 16. Empresas que ya existían

- **CP Odontología** abre el asistente con sus respuestas puestas: tipo `CLINICA`, oferta (rehabilitación oral, odontología general), territorio (Curicó), objetivo declarado, conversiones (WhatsApp, agenda, teléfono) y su conexión de datos del sitio. Su objetivo real no calza con ninguna opción del menú, así que esa pregunta **sí** se hace en lugar de forzar una equivalencia. **«No atendemos Fonasa» se escribe desde el flujo normal** y se persiste como `PROHIBITED_CLAIM`: no se añadió automáticamente, se comprobó que la interfaz permite introducirlo.
- **SmileFlow** se reconoce ya configurado: abrir el asistente no cambia su política, sus reglas ni sus capacidades (probado campo por campo), y su campaña sigue intacta.

## 17. Auditoría

`ONBOARDING_STARTED`, `ONBOARDING_PROGRESS_UPDATED`, `ONBOARDING_COMPLETED`, `ONBOARDING_REOPENED`, con actor, organización, paso, preguntas tocadas y progreso. Hitos, no pulsaciones; y ningún secreto en los payloads (probado).

## 18. Qué sigue

Esta fase **recopila y estructura**. No hay LLM, ni investigación de keywords, ni análisis de competencia, ni Keyword Planner, ni generación de campañas, anuncios, imágenes o landings, ni creación de conversiones externas.

Lo que viene es el salto de inteligencia: investigar el mercado por sí mismo y convertir todo lo aprendido en una estrategia y campañas propuestas. Ahora SOEC ya puede **recibir una empresa desde cero, entenderla y dejarla preparada** sin que nadie toque el código.
