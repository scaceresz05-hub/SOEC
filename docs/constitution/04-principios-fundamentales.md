# Principios Fundamentales — SOEC

> **Documento #4 de la Biblioteca Maestra.**
>
> **Pregunta que responde:** ¿Cómo debe comportarse permanentemente el proyecto — SOEC y quienes lo construyen — para permanecer fiel a sí mismo?
>
> **Lo que este documento NO gobierna:** el conocimiento, la evidencia, la verdad, la memoria, el aprendizaje, la incertidumbre, la justificación, la causalidad, los tipos de afirmación y la conservación semántica → **Filosofía (#3)**. Quién decide y bajo qué autoridad → **Gobierno (#6)**. Cómo se ejecuta cada principio → **Metodología (#7)**. La arquitectura elegida → **Arquitectura Conceptual (#9)**. Cómo se comprueba el cumplimiento → **Estándares (#15)**.

- **Versión:** 1.0 · **Fecha:** 2026-07-19 · **Estado:** ✅ **ACEPTADO** — superó la auditoría de jurisdicción, fronteras, interpretación-vs-legislación, solidez del Test de Decisión y sobreextensión. Todo cambio posterior sigue el Art. 8 de la Constitución.
- **Posición:** el Artículo 5 y el Artículo 2 de la Constitución **declaran** los invariantes; este documento los **interpreta** como conducta permanente; el #7 los **ejecuta** y el #15 los **comprueba**.

---

## 1. Propósito y uso

Este documento no crea deberes nuevos ni re-legisla ninguno. Toma los invariantes declarados en la Constitución y el rumbo fijado por el Objetivo Supremo, y establece **cómo se comporta el proyecto cuando tiene que decidir**.

Su utilidad práctica es concreta: dentro de cinco o diez años, ante la pregunta *«¿debemos incorporar esta capacidad?»*, la respuesta no debe depender de la autoridad ni del entusiasmo de quien la propone, sino de estos principios y del **Test de Decisión** de la sección 7.

**Sujeto.** A diferencia del #3, donde el sujeto era *SOEC conoce*, aquí el sujeto es **SOEC actúa** — y con frecuencia no es SOEC, sino el arquitecto, el equipo, la organización o la propia evolución del producto.

## 2. Criterios permanentes de decisión

**Carga de la prueba.** Toda propuesta que pretenda modificar el proyecto, aumentar su complejidad, debilitar una restricción, introducir una excepción o alterar una decisión previamente justificada **asume la carga de demostrar la necesidad, compatibilidad y beneficio del cambio**. La conservación del estado vigente no requiere justificación adicional; quien propone cambiarlo debe justificar el cambio. *Este principio gobierna la aplicación de todos los demás: cuando la carga se invierte —cuando se exige demostrar el daño en lugar de la necesidad—, el resto de los principios queda sin defensa.*

**Simplicidad exigible.** No se aumenta la complejidad sin necesidad demostrable. La carga de la prueba recae siempre en quien propone añadir, nunca en quien pide justificar. Una complejidad que nadie puede explicar es una complejidad que nadie podrá mantener.

**Arquitectura antes que funcionalidad.** La presión funcional no autoriza a romper el diseño. Ninguna urgencia, compromiso comercial ni expectativa externa justifica quebrar el núcleo para incorporar una función: si la función no cabe en la arquitectura, se rediseña la arquitectura deliberadamente o se posterga la función. Lo que no se hace es introducir la función rompiendo lo que sostiene todo lo demás.

**Reversibilidad.** Las decisiones se prefieren reversibles. **Cuanto más difícil sea deshacer una decisión, mayor evidencia, deliberación y respaldo exige antes de tomarse.** Una decisión reversible puede tomarse con información incompleta y corregirse; una irreversible no admite ese lujo.

**Responsabilidad proporcional al impacto.** A mayor impacto sobre personas u organizaciones, mayor disciplina exigible en evidencia, transparencia, validación y supervisión. Este principio es permanente y no depende del organigrama; **las competencias y procedimientos que lo hacen efectivo pertenecen al Gobierno (#6).**

**Priorización por capacidad, no por volumen.** Se prioriza aquello que aumenta la comprensión y la capacidad de la organización, no aquello que solo produce más funciones. Un catálogo creciente de capacidades que no eleva la comprensión de nadie es crecimiento aparente.

**Fundación antes que implementación.** Primero se actualiza el conocimiento, después se cambia el código. Esta secuencia no fue una preferencia de arranque: reaparece en cada cambio estructural.

## 3. Conducta de construcción

**Inspeccionar antes de modificar.** Se verifica la estructura real; no se asume. Actuar sobre una suposición cuando el hecho puede comprobarse es una falta de método, no un atajo.

**Deuda responsable.** Contraer deuda es legítimo; ocultarla no. **La velocidad nunca justifica deteriorar el núcleo.** Toda deuda asumida se declara, se acota y se registra con la condición que la haría exigible. Una deuda que nadie registró no es una decisión de ingeniería: es un daño diferido.

**Honestidad de estado.** Lo hecho se reporta como hecho, lo pendiente como pendiente, lo incierto como incierto. **No se declara terminado lo que no se verificó.** El progreso aparente es más costoso que el retraso reconocido, porque destruye la capacidad de planificar.

**Honestidad intelectual aplicada.** Interpretada como conducta permanente del proyecto, exige: no optimizar demostraciones para que un resultado luzca mejor de lo que es; no esconder deuda conceptual tras funcionalidad visible; no priorizar la apariencia sobre la comprensión; y **admitir un límite antes que inventar una respuesta**. Una propuesta se evalúa por su razonamiento y no por quién la formula — incluida la propia.

## 4. Evolución e identidad

**Evolución compatible.** El proyecto cambia permanentemente; su identidad no. Ninguna evolución —técnica, comercial o de escala— puede alterar lo que hace que SOEC siga siendo SOEC. Cuando una oportunidad exige romper la identidad, **la oportunidad se rechaza o el proyecto reconoce que está fundando otra cosa.**

**Crecer sin diluir.** Incorporar capacidades no puede debilitar el núcleo. Un sistema que crece perdiendo coherencia no se vuelve más capaz: se vuelve más difícil de comprender, que es exactamente lo contrario de su propósito.

**Continuidad del conocimiento del proyecto.** El conocimiento del proyecto pertenece al proyecto, **nunca a una persona**. Ninguna decisión, criterio o comprensión relevante puede residir únicamente en la memoria de quien la tuvo. Lo que solo una persona puede reconstruir todavía no es del proyecto.

**Preferencia por lo comprensible sobre lo ingenioso.** Entre dos soluciones equivalentes se elige la que más personas podrán entender, mantener y corregir dentro de cinco años. La brillantez que solo su autor comprende es una forma de deuda.

## 5. Relación con las personas y las organizaciones

**Transparencia organizacional.** Ninguna organización debe depender de comprender magia. Si el funcionamiento de SOEC resulta inexplicable para quien lo usa, el defecto es del sistema, no del usuario.

**No cautividad.** La organización que adopta SOEC no queda cautiva de él. Su conocimiento, sus datos y sus representaciones deben poder salir en forma comprensible y utilizable. Una infraestructura de la que no se puede salir no amplía la autonomía: la sustituye por dependencia.

**La anti-atrofia manda sobre la eficiencia.** Toda función o automatización se evalúa **por lo que deja en la organización, no solo por lo que le ahorra**. Una función que mejora el rendimiento inmediato y deteriora la comprensión, la competencia o la capacidad de recuperación es incompatible con este proyecto y debe rechazarse o rediseñarse. La eficiencia, por sí sola, nunca es justificación suficiente.

**Protección reforzada de quien soporta las consecuencias.** El proyecto otorga prioridad especial a la protección de quienes soportan directamente los riesgos y las consecuencias de una decisión, **haciendo explícitos los intereses que se benefician de ella y la justificación de la ponderación realizada**. Quien soporta, quien financia, quien regula y quien mantiene pueden tener intereses legítimos simultáneamente: este principio **no resuelve automáticamente esa ponderación — exige que se realice de forma explícita y justificada, nunca silenciosa.**

**No diseñar para reemplazar el criterio.** Ninguna función se concibe con el propósito de que la persona deje de entender. Facilitar la decisión es legítimo; volverla innecesaria de comprender, no.

## 6. Conducta del propio proyecto

**Ningún principio se cumple por declaración.** Este documento no otorga cumplimiento: lo exige. Un principio que no se aplica cuando resulta incómodo no está vigente, está decorando.

**La incomodidad no es motivo de excepción.** Los principios se prueban exactamente cuando estorban: bajo presión de plazo, de cliente o de expectativa. Ceder en ese momento no es pragmatismo, es derogación tácita — y la Constitución no admite enmienda tácita.

**Toda excepción es explícita, acotada y registrada.** Cuando exista una razón real para apartarse de un principio, se declara cuál, por qué, hasta cuándo y qué la revierte. Una excepción no registrada se convierte, con el tiempo, en la nueva norma.

## 7. Test de Decisión

Toda propuesta de nueva capacidad, cambio estructural o automatización debe poder responder estas preguntas. **Una respuesta ausente o insatisfactoria es motivo suficiente para no avanzar.**

1. **¿Qué comprensión añade a la organización?** Si solo añade funciones, no califica (§2).
2. **¿Qué complejidad introduce y por qué es necesaria?** La carga de la prueba es de quien propone (§2).
3. **¿Es reversible?** Si no lo es, ¿el respaldo es proporcional a esa irreversibilidad? (§2)
4. **¿A quién impacta y con qué gravedad?** ¿La disciplina exigida es proporcional a ese impacto? (§2)
5. **¿Cabe en la arquitectura actual?** Si no, ¿se rediseña deliberadamente o se posterga? No se rompe el núcleo (§2).
6. **¿Deja a la organización más capaz o más dependiente?** Si la vuelve dependiente, es incompatible (§5).
7. **¿Puede la persona seguir comprendiendo, impugnando y decidiendo?** (§5, y las condiciones de soberanía del #3)
8. **¿Podrá otra persona entenderlo y mantenerlo en cinco años?** (§4)
9. **¿Qué deuda contrae y bajo qué condición se salda?** Si no puede declararse, no se contrae (§3).
10. **¿Se actualizó el conocimiento antes que el código?** (§2)
11. **¿Preserva la identidad constitucional de SOEC?** Una propuesta puede responder satisfactoriamente las diez preguntas anteriores y **aun así alejar al proyecto de aquello que constitucionalmente es**. Esta pregunta abarca a todas las demás y **puede vetar por sí sola** (§4, y Artículo 2 de la Constitución).

## 8. Principios consolidados

| Principio | Qué impide |
|---|---|
| **Carga de la prueba** | Que se exija demostrar el daño en lugar de la necesidad; que el estado vigente deba defenderse a sí mismo |
| **Simplicidad exigible** | Que la complejidad crezca sin que nadie deba justificarla |
| **Arquitectura antes que funcionalidad** | Romper el núcleo por presión funcional, comercial o de plazo |
| **Reversibilidad** | Tomar decisiones irreversibles con el respaldo de una reversible |
| **Responsabilidad proporcional al impacto** | Aplicar la misma ligereza a decisiones de consecuencias muy distintas |
| **Priorización por capacidad** | Confundir más funciones con más valor |
| **Fundación antes que implementación** | Cambiar el sistema antes de haber actualizado su comprensión |
| **Inspeccionar antes de modificar** | Actuar sobre supuestos cuando el hecho es verificable |
| **Deuda responsable** | Deuda contraída en silencio; velocidad pagada con el núcleo |
| **Honestidad de estado** | Progreso aparente; dar por terminado lo no verificado |
| **Honestidad intelectual aplicada** | Demostraciones optimizadas, deuda conceptual oculta, respuestas inventadas ante un límite |
| **Evolución compatible** | Que una oportunidad altere la identidad sin reconocerlo |
| **Crecer sin diluir** | Que añadir capacidades degrade la coherencia del núcleo |
| **Continuidad del conocimiento** | Que una comprensión crítica resida solo en una persona |
| **Preferencia por lo comprensible** | Soluciones ingeniosas que solo su autor mantiene |
| **Transparencia organizacional** | Que el usuario deba confiar sin poder entender |
| **No cautividad** | Que la organización no pueda salir con su propio conocimiento |
| **Anti-atrofia sobre eficiencia** | Automatizar por ahorro degradando capacidad |
| **Protección reforzada de quien soporta consecuencias** | Que la ponderación entre quien asume el riesgo y quien obtiene el beneficio se haga en silencio |
| **No diseñar para reemplazar el criterio** | Funciones concebidas para que la persona deje de entender |
| **Sin excepción por incomodidad** | Derogación tácita bajo presión |
| **Excepción explícita y registrada** | Que una excepción silenciosa se convierta en la norma |

## 9. El carácter que estos principios describen

Los principios anteriores están formulados en buena parte como límites, porque un límite es lo único que impide una implementación incorrecta. Pero en conjunto no describen una lista de prohibiciones: describen un carácter.

> **En conjunto, estos principios describen un proyecto que prefiere comprender antes que acelerar, fortalecer antes que expandir, explicar antes que impresionar y preservar capacidad antes que acumular funcionalidad.**

---

**Continuidad.** Todo principio de este documento se deriva de los invariantes declarados en los Artículos 2 y 5 de la Constitución y del Objetivo Supremo. Su ejecución corresponde a la Metodología (#7), su verificación a los Estándares (#15), y las competencias y procedimientos que los hacen efectivos al Gobierno (#6). Este documento gobierna **los criterios para decidir** la arquitectura; la arquitectura elegida se describe en el #9.
