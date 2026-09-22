# SOEC · Investigación autónoma y planificación de campañas (Autonomy Fase E)

**Fecha:** 2026-09-21 · **Afirmación que esta fase deja demostrada:** *una empresa preparada pide «investigar mi mercado» y SOEC produce, sola, evidencia con procedencia, hallazgos, veredicto por canal, oportunidades de búsqueda, territorio ejecutable y un plan de campaña en borrador — sin Claude, sin búsquedas manuales, sin Keyword Planner a mano, sin hojas externas, sin editar TypeScript y sin desplegar nada por empresa.*

El principio del módulo, escrito una vez y respetado en todo el código:

> **Evidencia antes que «IA».** Cada afirmación lleva su clase, su fuente, su período, su geografía y su fecha de observación. Un dato sin procedencia no sirve para decidir, y una frase generada no es una medición.

Y el límite, igual de explícito:

> **Esta fase no ejecuta nada.** Google Ads CREATE = 0 · Meta CREATE = 0 · mutaciones externas = 0 · gasto = 0. El plan termina en borrador, y publicarlo sigue siendo una decisión de una persona.

Contexto: [BUSINESS_AS_DATA.md](BUSINESS_AS_DATA.md) · [CONNECTIONS_AS_DATA.md](CONNECTIONS_AS_DATA.md) · [EVALUATION_POLICY_AS_DATA.md](EVALUATION_POLICY_AS_DATA.md) · [INTELLIGENT_BUSINESS_ONBOARDING.md](INTELLIGENT_BUSINESS_ONBOARDING.md) · [RUNTIME_FOUNDATION.md](RUNTIME_FOUNDATION.md) · [../auditoria/SOEC_AUTONOMY_GAP_AUDIT.md](../auditoria/SOEC_AUTONOMY_GAP_AUDIT.md).

---

## 1. Clases de evidencia

| Clase | Qué significa | Ejemplo |
| --- | --- | --- |
| `OBSERVED` | Medido en una fuente real, con período y geografía | «implante dental curicó»: 320 búsquedas mensuales promedio |
| `DERIVED` | Calculado a partir de lo observado, con su regla | costo diario de capturar toda la demanda observada |
| `ASSUMED` | Supuesto declarado como tal; nunca se presenta como medición | interpretación de un texto sin datos detrás |
| `USER_CONFIRMED` | Lo dijo el dueño y quedó persistido | «no atendemos Fonasa» |
| `UNKNOWN` | No se sabe, y eso es una respuesta válida | no hay fuente de competidores en este despliegue |

Toda evidencia vive en `research_evidence` con `clase`, `fuente`, `statement`, `datos`, `periodo`, `geografia` y `observado_en`. La confianza de un hallazgo se **deriva** de las clases que lo sostienen (`confianzaDesdeEvidencia`): observado sin supuestos ⇒ alta; con supuestos ⇒ media; sin evidencia ⇒ baja.

## 2. La corrida de investigación es una entidad

```
QUEUED ──hay cupo──▶ RUNNING ──┬── todas las fuentes sirvieron ──▶ COMPLETE ──┐
                               ├── alguna faltó o falló ─────────▶ PARTIAL  ──┼── cambian los datos ──▶ STALE
                               └── ninguna sirvió ───────────────▶ FAILED      ┘
```

`ResearchRun` (`research_run`) guarda el alcance pedido, el estado, **qué fuente se usó y qué fuente no**, los fallos, la frescura y la firma de los datos de entrada. Se puede consultar, repetir, comparar y envejecer.

* **`PARTIAL` es un resultado válido.** Una fuente caída no borra las demás: lo que se pudo observar se conserva con su procedencia y la confianza baja donde corresponde.
* **Nada se fabrica.** Sin fuente de demanda no hay términos ni volúmenes: hay `GOOGLE_ADS_KEYWORD_DATA: UNAVAILABLE` con su motivo y un hallazgo `DATA_INSUFFICIENT`.
* **Lo que cambia, envejece.** La corrida guarda una firma (`oferta`, `territorio`, `restricciones`, `presupuesto`, `sitio`, `conversiones`). Al leer, si la firma actual difiere, la corrida pasa a `STALE` diciendo **qué** cambió — sin borrar la evidencia anterior.

Siete tablas cuelgan de la corrida —`research_evidence`, `research_finding`, `research_keyword`, `research_geo_target`, `research_channel`, `research_landing`— más `research_competitor`, cuya vida es más larga que una corrida.

## 3. Auditoría comercial del propio sitio

La lectura de una página del onboarding evoluciona a un rastreo **acotado** del propio dominio (`sitio-auditoria.ts`): título, meta descripción, encabezados, llamadas a la acción, vías de contacto, canónica, indexabilidad y datos estructurados. **No se guarda el cuerpo de las páginas.**

Límites duros, porque un rastreador sin límites es un problema incluso sobre el sitio propio:

| Límite | Valor por defecto |
| --- | --- |
| Páginas por corrida | 12 |
| Profundidad | 2 |
| Tiempo por página | 5 s |
| Bytes por página | 512 KiB |

Y las defensas de red que ya traía el onboarding: sólo `https`, sólo el **mismo dominio registrable** (cualquier enlace externo se ignora, no se visita), y el host debe resolver a una IP pública **antes** de la primera petición. Un sitio caído o lento no es una excepción: es un hallazgo.

## 4. Compatibilidad de landing (no se crea ninguna)

| Estado | Significado |
| --- | --- |
| `READY` | Hay página propia, indexable, con invitación a actuar y vía de contacto |
| `WEAK` | Existe, pero le falta algo — y se dice qué |
| `MISSING` | Ninguna página del sitio habla de esa oferta |
| `BLOCKED` | La página afirma algo que el negocio declaró que **no** puede afirmar, o no es indexable |

La correspondencia página ↔ oferta compara **raíces** de palabras (singular/plural) y elige la página de **mayor afinidad**, no la primera que coincida: con ofertas que comparten una palabra genérica («dental»), quedarse con la primera mandaría el tráfico de una oferta a la página de otra.

## 5. Demanda de búsqueda real

`KeywordPlanIdeaService.GenerateKeywordIdeas` sobre la API de Google Ads (v25, **sólo lectura**), con las **ofertas del negocio** como semillas y los geotargets resueltos como ámbito. No hay términos escritos a mano en el código, no hay nada específico de ninguna empresa y **no se depende de una campaña activa**: basta una cuenta conectada con permiso de lectura, así que una empresa nueva puede investigar el primer día.

Sin Google: `GOOGLE_KEYWORD_DATA = UNAVAILABLE` con su motivo, y la investigación continúa con las demás fuentes.

### Intención de búsqueda — reglas auditables

Cada término queda con `intencion`, `metodo` (`RULES_V1`), `confianza` y **con qué coincidió**:

`EMPLOYMENT` · `EDUCATIONAL` · `IRRELEVANT` · `NAVIGATIONAL` · `TRANSACTIONAL` · `LOCAL` · `COMMERCIAL` · `INFORMATIONAL`

El **orden** de las reglas es el producto: empleo y formación ganan (quien busca trabajo o estudiar no es cliente); la relación con la oferta se evalúa **antes** de llamar irrelevante a nada.

> **«precio implante dental» es intención COMERCIAL, no basura.** Contiene «precio» junto a una oferta declarada: es quien está más cerca de decidir. Excluirlo sería tirar al mejor cliente.

### Candidatos a negativa ≠ negativas activas

Un término `EXCLUDED` produce un **candidato** con su motivo y su evidencia. Aplicarlo sigue siendo una decisión humana. Y una restricción que nadie persistió **no se asume**: sin «no atendemos Fonasa» guardado, «implantes dentales fonasa» no se excluye por su cuenta.

Un término sin relación con la oferta declarada no se tira a la basura: va a `NEEDS_REVIEW`, porque quien conoce el negocio es el dueño.

## 6. Territorio: comercial ⇢ ejecutable

`GeoTargetConstantService.SuggestGeoTargetConstants` (sólo lectura) traduce el territorio declarado a objetivos **reales** de la plataforma. Tres desenlaces, todos explícitos:

* **disponible y exacto** (`CITY`) — `aproximacion: false`, `riesgoDerrame: NONE`;
* **disponible sólo con una unidad más amplia** — `aproximacion: true`, riesgo de derrame declarado, y un prerrequisito en el plan;
* **no disponible** — queda fuera del plan y **también** como prerrequisito: excluir territorio que el dueño sí declaró atender es una decisión suya, no una nota al pie.

**No hay sustitución silenciosa por radio ni por región.**

## 7. Veredicto por canal (estados, no notas)

`GOOGLE_SEARCH` · `META_PAID` · `ORGANIC_SEARCH` · `ORGANIC_SOCIAL`, cada uno con `SUITABLE` / `POSSIBLE` / `INSUFFICIENT_EVIDENCE` / `NOT_SUITABLE` / `BLOCKED` **y sus motivos**. Nunca un número del 1 al 10: un ranking no se puede discutir ni corregir, y esconde de qué depende la respuesta.

> **Demanda no es recomendación.** Con demanda observada pero sin página donde aterrizar, sin territorio segmentable, sin conversión declarada o sin techo de inversión, el veredicto es `POSSIBLE` con el motivo — no `SUITABLE`.

`INSUFFICIENT_EVIDENCE` es una respuesta legítima y frecuente: de Meta no sabemos si hay material visual, y de las redes orgánicas no se ha observado ninguna cuenta. No se inventa.

## 8. Competidores

Por defecto **no hay fuente confiable**, y la respuesta honesta es `COMPETITOR_DATA_INSUFFICIENT`. No se hace rastreo agresivo de terceros ni se deduce una lista plausible: un competidor inventado es peor que ninguno.

## 9. Arquitectura de proveedores (neutral)

El dominio pide **evidencia estructurada**, nunca texto libre:

| Puerto | Hoy lo sirve |
| --- | --- |
| `SearchDemandProvider` | Google Ads Keyword Ideas (sólo lectura) |
| `GeoTargetProvider` | Google Ads Geo Target Constants (sólo lectura) |
| `WebsiteResearchProvider` | auditoría HTTP del propio sitio |
| `MarketResearchProvider` | *sin fuente* (devuelve `null` a propósito) |
| `ReasoningProvider` | **declarado, sin implementación** |

Ningún nombre de proveedor de modelos aparece en el dominio, y las pruebas de arquitectura que prohíben SDKs de proveedor siguen en pie. `ReasoningProvider` existe como contrato para el día que una capacidad **exija** razonamiento generativo: su entrada sería evidencia ya recogida, su salida entraría como `ASSUMED` —jamás como `OBSERVED`— y el producto debe seguir funcionando con ese proveedor ausente.

Lo que hoy **no** necesita razonamiento generativo y por eso no lo usa: clasificar intención, derivar hallazgos, evaluar canales, resolver territorios, evaluar landings y planificar. Lo que lo necesitaría en el futuro: redactar anuncios, interpretar textos comerciales ambiguos y resumir el mercado en prosa.

## 10. Gobierno de cuota

La lección del 429 se aplica desde el primer día:

* **single-flight por organización y consulta** (`CoordinadorDeConsultas`): dos pantallas abiertas no producen dos llamadas;
* **caché en memoria de 30 min** por consulta;
* **frescura** de 7 días por corrida: pedir investigación con datos frescos y sin cambios **reutiliza** la anterior sin consultar a nadie;
* **tope de corridas simultáneas** (2): por encima, la corrida queda `QUEUED` diciendo por qué, en lugar de golpear la cuota;
* **abrir una pantalla no consulta nada**: `GET /investigacion` sólo lee lo persistido. Repetir es un acto explícito (`forzar`).

## 11. El plan de campaña

`CampaignPlan` (`campaign_plan` + `campaign_plan_group`) es una **propuesta versionada**, no una campaña: no existe ningún identificador de Google o Meta en él. Estados: `DRAFT` · `NON_EXECUTABLE` · `STALE` · `SUPERSEDED`.

`planificar()` es una **función pura**: con la misma evidencia produce exactamente el mismo plan, lo que permite discutirlo, versionarlo y compararlo.

**Presupuesto — cuatro cifras distintas que nunca se confunden:**

| Cifra | De dónde sale |
| --- | --- |
| Techo declarado | lo que el dueño dijo en el asistente |
| Gasto propuesto | **derivado del techo declarado** |
| Oportunidad de mercado | lo que costaría capturar toda la demanda observada — derivación, no recomendación |
| Gasto autorizado | **no existe en esta fase**: lo firma una persona |

Sin techo declarado no se propone gasto alguno: proponerlo sería inventar dinero ajeno. El plan lo dice y lo pide como prerrequisito.

**Estructura:** se decide con volumen, presupuesto y separación de landing. Una oferta **no** es una campaña: repartir un presupuesto pequeño entre varias campañas deja a todas sin datos suficientes, así que la propuesta por defecto es una campaña con un grupo por oferta, y una campaña por oferta sólo cuando hay demanda propia, páginas distintas y presupuesto que lo sostenga.

**Concordancias:** `EXACT` con intención inequívoca y volumen; `PHRASE` cuando la señal es buena pero admite variantes; **`BROAD` sólo con justificación explícita** (historial de conversiones y cobertura de negativas). En un primer plan no se propone, y se explica por qué.

**Puja:** comprar clics con techo de costo mientras no haya historial fiable de conversiones; optimizar a conversiones cuando lo haya. Con su justificación y el número observado.

**Lo que falta no se esconde:**

| Dimensión | Cuándo está lista |
| --- | --- |
| `RESEARCH_READY` | hay demanda observada y territorio ejecutable |
| `LANDING_READY` | todas las ofertas planificables tienen página lista |
| `MEASUREMENT_READY` | la conversión existe **y está verificada** |
| `BUDGET_READY` | hay techo declarado y alcanza para al menos un clic |
| `CREATIVE_READY` | hay anuncios escritos — **esta fase no los genera, así que es `false`** |
| `EXECUTION_READY` | todas las anteriores — **por lo tanto, `false` en esta fase** |

Como SOEC todavía no crea conversiones externas, el requisito es `CONVERSION_SETUP_REQUIRED` o `CONVERSION_TRACKING_UNVERIFIED`, y `CAMPAIGN_EXECUTION_READY = NO`. Ese bloqueo aparece en primer plano en la pantalla, no escondido al final.

**Versionado:** cada generación es una versión nueva; la anterior queda `SUPERSEDED` con su fecha y **sigue consultable**. Si la corrida en que se apoyaba envejece —o aparece una más reciente—, el plan pasa a `STALE` diciendo por qué.

**Explicabilidad:** cada decisión del plan lleva `{ decision, porque, evidenciaIds }`. Nunca «porque la IA lo recomienda».

## 12. Superficie HTTP e interfaz

| Ruta | Qué hace | Permiso |
| --- | --- | --- |
| `GET /investigacion` | estado, evidencia, hallazgos, términos, territorio, canales, landings, frescura | contexto de organización |
| `POST /investigacion` | investiga (reutiliza si está fresca; `forzar` repite) | `business.manage` |
| `GET /plan` | último plan, sus grupos y el historial | contexto de organización |
| `POST /plan` | genera una versión nueva | `business.manage` |

**No existe ninguna ruta que publique nada**, ni siquiera detrás de un permiso.

Dos pantallas, en lenguaje de negocio y sin GAQL ni payloads: **Investigación de mercado** (`/negocios/investigacion`) —investigar, ver progreso, ver de dónde salió cada dato, ver hallazgos, ver frescura, repetir— y **Plan de marketing** (`/negocios/plan`) —qué propone SOEC, por qué, con qué evidencia, cuánto propone invertir y qué falta antes de publicar.

## 13. Qué queda demostrado por prueba

`apps/api/test/autonomous-research.test.ts` (47 casos, sin base ni red) e `autonomous-research.pg.test.ts` (12 casos sobre PostgreSQL real, por las mismas APIs que usa la interfaz y con proveedores simulados deterministas):

* misma evidencia ⇒ **mismo plan**, y versionado sin borrar el anterior;
* evidencia ausente ⇒ investigación `PARTIAL` válida y plan a la espera, **sin datos fabricados**;
* restricción persistida ⇒ término excluido y página `BLOCKED` citando lo que el negocio declaró;
* territorio no segmentable ⇒ prerrequisito; territorio aproximado ⇒ prerrequisito con su riesgo;
* landing ausente, conversión sin declarar o sin autorización humana ⇒ `EXECUTION_READY = false`;
* cambiar el territorio ⇒ investigación y plan `STALE` con su motivo, historial intacto;
* abrir la pantalla no consulta a Google; repetir es un acto explícito;
* una empresa no lee, no investiga y no planifica el mercado de otra;
* y el límite absoluto: **cero campañas, cero mutaciones externas, cero gasto autorizado**.

## 14. Lo que esta fase NO hace

No crea conversiones externas · no publica campañas en Google ni en Meta · no genera creatividades, imágenes ni vídeo · no optimiza campañas activas · no cambia presupuestos por su cuenta · no crea landing pages · no gasta un peso.
