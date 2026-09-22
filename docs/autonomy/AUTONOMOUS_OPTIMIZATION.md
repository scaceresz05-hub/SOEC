# SOEC · Optimización autónoma (Autonomy Fase G)

**Fecha:** 2026-09-22 · **Afirmación que esta fase deja demostrada:** *SOEC puede supervisar una campaña, detectar problemas y oportunidades, decidir una acción, comprobar si está autorizado para realizarla, ejecutarla de forma idempotente y verificar el resultado — sin intervención técnica y dentro de los límites que fijó el dueño.*

El ciclo, y cada flecha es una puerta que se puede cerrar:

```
OBSERVAR → EVALUAR → DECIDIR → GOBERNAR → EJECUTAR → VERIFICAR → APRENDER → (repetir)
```

Y las dos separaciones que sostienen todo el módulo:

> **Política de autonomía = QUÉ puede hacer.** **Mandato financiero = CUÁNTO puede comprometer.**
> Ninguna se infiere de la otra, y ninguna se infiere del modo operativo.

Contexto: [EVALUATION_POLICY_AS_DATA.md](EVALUATION_POLICY_AS_DATA.md) · [AUTONOMOUS_RESEARCH_AND_CAMPAIGN_PLANNING.md](AUTONOMOUS_RESEARCH_AND_CAMPAIGN_PLANNING.md) · [CONVERSION_AND_CAMPAIGN_EXECUTION.md](CONVERSION_AND_CAMPAIGN_EXECUTION.md).

---

## 1. Qué se evolucionó (y por qué no hay un segundo director)

| Pieza existente | Qué aporta al ciclo |
| --- | --- |
| `stopMonitor` | **camino de seguridad INDEPENDIENTE**: sigue pudiendo pausar sin depender del ciclo |
| `directorCycle` | lectura de evidencia y post-mortem; el optimizador usa las mismas consultas de solo lectura |
| política de evaluación (Fase C) | los umbrales de pausa, éxito y evidencia mínima — **declarados por la empresa**, no inventados |
| mandato financiero | el tope duro de dinero, firmado por una persona |
| ejecutor de campañas (Fase F) | el **mismo** transporte atómico y el mismo cliente para escribir |
| gobierno + capacidades + modo operativo | quién puede hacer qué en qué cuenta |
| event store y auditoría | el rastro de cada decisión y cada cambio |

El módulo `optimizacion/` no reemplaza nada: **ata** esas piezas en un ciclo que antes no existía. No hay `director-v2` ni un segundo camino de escritura.

## 2. El ciclo es una entidad

```
QUEUED → OBSERVING → EVALUATING ─┬─ WAITING_FOR_EVIDENCE   (lo más frecuente, y está bien)
                                 ├─ NO_ACTION
                                 └─ DECIDED ─┬─ WAITING_FOR_APPROVAL
                                             └─ EXECUTING → VERIFIED
                                                          └─ FAILED
```

`optimization_cycle` guarda organización, campaña, modo, ventana, snapshot, **versión de la política de evaluación, versión de la política de autonomía y versión del mandato**, el modo operativo y el resumen. Sin esas versiones no se puede reconstruir por qué se decidió lo que se decidió.

## 3. Snapshot de observación (inmutable)

`observation_snapshot` congela lo que SOEC vio: métricas de campaña, grupos, anuncios, palabras y términos de búsqueda, con la ventana, la fuente y **hasta cuándo llegaban los datos del proveedor**.

> **Una métrica que no existe es `null`, nunca cero.** Cero clics y «no sabemos cuántos clics» llevan a decisiones opuestas.

Las métricas derivadas (CTR, CPC, CPA, CVR) sólo se calculan cuando sus componentes existen.

## 4. Portero de evidencia

Antes de decidir: `SUFFICIENT` · `INSUFFICIENT` · `STALE` · `CONFLICTING`.

Se exige, en este orden: datos frescos (no más de 48 h de retraso), señales coherentes (no hay conversiones sin clics), cooldown cumplido, y el **mínimo de evidencia que la empresa declaró** en su política. Sin mínimo declarado no se optimiza: no se inventa un umbral.

Además, `permiteDecisionesDeConversion` sólo es `true` con la **medición sana**. Con la medición degradada hay evidencia de tráfico, pero ninguna decisión basada en conversiones es defendible.

## 5. Decisiones deterministas

Ninguna regla necesita un modelo de lenguaje; `ReasoningProvider` (Fase E) sigue siendo un puerto opcional para el futuro. Los tres errores que el motor evita a propósito:

1. **Pausar por «0 conversiones».** Se exige gasto improductivo por encima del criterio declarado **y** clics suficientes **y** medición sana. Un término o palabra que convirtió no se toca.
2. **Negativizar «precio», «valor», «cuotas».** Quien pregunta precio está evaluando comprar. Sólo se excluye lo que es de otra intención (empleo, formación) o lo que choca con algo que la empresa declaró que no puede afirmar.
3. **Perseguir el ruido.** Banda muerta del 5 %, cooldown, tope de cambios por día y memoria del último cambio: no hay bucle +10 % / −10 %.

Acciones soportadas: `PAUSE_CAMPAIGN` · `PAUSE_AD_GROUP` · `PAUSE_KEYWORD` · `ADD_NEGATIVE_KEYWORD` · `ADJUST_DAILY_BUDGET` · `ADJUST_MAX_CPC` · `ENABLE_CAMPAIGN`. Declaradas y **no** ejecutables aún: `CREATE_KEYWORD`, `CREATE_AD`. Cambiar de **estrategia** de puja (a maximizar conversiones, tCPA, tROAS) queda fuera: es otra decisión, con otra evidencia.

Cada decisión persiste: acción, objetivo, estado actual → propuesto, referencias de evidencia y de política, efecto esperado, riesgo, confianza, reversibilidad, motivo e **impacto máximo posible**. Nunca «lo decidió la IA».

## 6. Riesgo

`SAFETY` (reduce exposición) · `LOW_RISK` · `MEDIUM_RISK` · `HIGH_RISK` · `PROHIBITED`. La clasificación es de dominio y estable: la misma acción pesa siempre lo mismo. Pausar la campaña es `SAFETY`; encenderla es `HIGH_RISK`; superar el mandato no es un riesgo alto, es imposible.

## 7. Gobierno

Orden deliberado de las puertas: modo sombra → interruptor del despliegue → postura de gobierno de la empresa → capacidad de escritura → modo operativo → acción permitida → permiso de activación → mandato → ritmo (tope diario, cooldown, horario) → riesgo.

| Modo operativo | Qué ocurre |
| --- | --- |
| `PILOT` (observar) | todo se propone, nada se aplica |
| `SUPERVISED_REAL` | cada acción espera la aprobación de una persona |
| `AUTONOMOUS_REAL` | se aplica **sólo** lo que la política de autonomía permite, dentro del mandato y del ritmo |

`autonomy_policy` guarda: acciones permitidas, máximo cambio de presupuesto (%), máximo cambio de CPC (%), cambios por día, cooldown, horario y `activacionAutonomaPermitida`. **No guarda dinero.**

## 8. Activación de campaña

La Fase F creaba campañas siempre en pausa. Encenderla exige **ocho condiciones**: reconciliación correcta, medición verificada, mandato vigente, preparación completa, conexión válida, permiso de escritura, postura de gobierno abierta e interruptor abierto.

Y además:
* en `SUPERVISED_REAL`, la firma explícita de una persona (`ACTIVATE_CAMPAIGN`);
* en `AUTONOMOUS_REAL`, `activacionAutonomaPermitida = true`. **Nunca se infiere del presupuesto.**

## 9. Cola de aprobación

`pending_marketing_action` muestra qué quiere hacer SOEC, por qué, con qué evidencia, el cambio actual → propuesto, el riesgo y el impacto máximo posible. Opciones: aprobar, rechazar o ajustar. La aprobación vale para el mundo de **ahora**: al aprobar se reevalúan interruptor, permiso, gobierno y mandato.

## 10. Ejecución, idempotencia y verificación

Identidad estable: `organización:campaña:acción:objetivo:estadoPretendido`. Reintentar la misma intención devuelve `NOOP_ALREADY_APPLIED` sin tocar la plataforma. Antes de escribir se relee el estado remoto: si la palabra ya estaba pausada o alguien cambió el presupuesto por fuera, la decisión vieja **no** se aplica.

Después de escribir se relee y se compara: `VERIFIED` · `DIVERGED` · `UNKNOWN`. Un HTTP 200 no es una campaña cambiada.

## 11. Deriva y aislamiento

Un cambio hecho fuera de SOEC se detecta y se **muestra**; no se sobrescribe. Y un fallo en una empresa o una campaña no detiene a las demás: cada ciclo se abre, se cierra y se registra por separado.

## 12. Aprendizaje

`learning_outcome` guarda, por decisión: efecto esperado, métricas de antes, métricas de después y el veredicto (`IMPROVED` · `DEGRADED` · `INCONCLUSIVE` · `NOT_ENOUGH_TIME`). No hay modelo de aprendizaje todavía: hay **materia prima honesta** para tenerlo.

## 13. Modo sombra

`SHADOW` es una capa técnica, distinta del modo comercial «sólo observar»: el motor observa campañas reales, decide y **registra qué habría hecho**, con cero escrituras. Es la forma de comprobar el criterio del optimizador antes de cederle control.

## 14. Meta

`META_AUTONOMOUS_EXECUTION = BLOCKED_EXTERNAL`: el scope `ads_management` sigue prohibido en el OAuth de solo lectura de SOEC. El optimizador puede observar, evaluar y proponer para Meta; ejecutar, no.

## 15. Qué queda demostrado por prueba

`apps/api/test/autonomous-optimization.test.ts` (66 casos) y `autonomous-optimization.pg.test.ts` (15 sobre PostgreSQL real, con Google simulado):

* con poca evidencia, datos viejos o señales contradictorias **no se decide**;
* «precio implante dental» no se excluye; «trabajo dentista» sí, con su motivo;
* una palabra sólo se pausa con gasto improductivo, clics suficientes y medición sana;
* el presupuesto sube como mucho el porcentaje autorizado y **nunca** por encima del mandato;
* con la medición degradada no hay decisiones por conversiones;
* reintentar es un NOOP; rechazar cierra la propuesta sin tocar nada;
* encender exige firma humana o permiso explícito, y siempre mandato vigente;
* en modo sombra hay decisiones y **cero** escrituras;
* una empresa no corre el ciclo, no aprueba y no enciende la campaña de otra.

## 16. Validación en sombra sobre una cuenta real

El 2026-09-22 se ejecutó un ciclo en modo `SHADOW` sobre la campaña real de SmileFlow (`24194332264`), con el
cliente de LECTURA — esa organización no tiene la capacidad de escritura activada:

```
optimizacion="observacion" org="org-smileflow" campaña="24194332264" palabras=22 terminos=0 datosHasta=null
ciclo: modo=SHADOW estado=WAITING_FOR_EVIDENCE
motivo: "no hay datos de impressions en esta ventana"
```

Resultado correcto y aburrido: la campaña lleva pausada desde principios de septiembre, así que en la ventana
observada **no hay datos**. El motor lo dijo tal cual — `sin dato`, nunca cero— y terminó sin decidir nada.
Cero escrituras al proveedor, cero 403, cero 429, y la campaña sigue en pausa.

## 17. Lo que esta fase NO hace

No cambia la estrategia de puja · no crea palabras ni anuncios · no rota creatividades · no negativiza por reglas genéricas de vocabulario comercial · no escribe en Meta · no enciende nada sin permiso explícito · no sube el presupuesto por encima del mandato · no sobrescribe los cambios que haga una persona por fuera.
