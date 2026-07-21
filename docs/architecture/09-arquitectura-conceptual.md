# Arquitectura Conceptual — SOEC

> **Documento #9 de la Biblioteca Maestra.** Capa Conceptual. Competencia primaria: **describir** la arquitectura conceptual elegida.
>
> **Pregunta que responde:** ¿Cómo está organizado conceptualmente SOEC?
>
> **Lo que este documento NO gobierna:** los criterios para *decidir* la arquitectura (→ #4), el gobierno, la permanencia y el método (→ #1, #6, #7), el **interior** de cada entidad —cómo funciona, cómo se calcula, qué estructura tiene— (→ #10 MED, #11 MDM, #12 Cerebro Empresarial, #13 Sistema de IA, #14 Capacidades) y la implementación técnica (→ #16).
>
> **Reglas de lectura de este documento:**
> - **Presente conceptual.** Describe el sistema como si ya existiera completamente. No dice «se implementará» ni «debería existir».
> - **Sitúa, no desarrolla.** El #9 establece el mapa; los #10–#14 desarrollan cada territorio. De cada entidad responde únicamente: **¿existe? · ¿dónde está? · ¿con qué limita? · ¿con qué se relaciona?**
> - **No redefine.** Ninguna entidad ya declarada en la Constitución o en la Filosofía se redefine aquí; solo se ubica y se conecta.
> - **Independiente de tecnología.** Nada de lo aquí descrito depende de lenguaje, framework, base de datos, interfaz ni motor de IA.

- **Versión:** 1.1 · **Fecha:** 2026-07-19 · **Estado:** ✅ Aceptado. *(v1.0 aprobado como raíz de la capa conceptual; v1.1 incorpora los invariantes 11 y 12 —Simetría de los modelos y Marco/Instanciación—, decisión del Director de Arquitectura al validar el #10: laguna revelada, la entidad Modelo carecía de estos invariantes de familia.)*

---

## I. Ontología del sistema — ¿qué existe dentro de SOEC?

La ontología se organiza en **tres planos**, que la Filosofía (#3 §2) ya declaró y que aquí se ordenan espacialmente: **Realidad**, **Representación** y **Apropiación**. SOEC no habita el primero; construye el segundo; sirve al tercero.

### Plano de la Realidad *(SOEC no lo posee; solo interactúa con él)*

- **Empresa.** La organización real, con su operación, personas, recursos e historia. Existe con independencia de SOEC.
- **Mundo.** El entorno real de la empresa: clientes, economía, normas, tecnología, competencia. Existe con independencia de SOEC.
- **Relación evolutiva Empresa↔Mundo.** El vínculo cambiante entre ambos. **Es el objeto de atención de SOEC**, no una posesión suya.

### Plano de la Representación *(donde se origina el conocimiento que SOEC sostiene)*

- **Representación.** Toda construcción interna que SOEC sostiene sobre algún aspecto de la realidad. Es la materia de la que están hechas las demás entidades de este plano.
- **Modelo.** Una representación de un aspecto determinado de la realidad, construida para un propósito. El **Modelo Empresarial Digital (MED)** representa la empresa; el **Modelo del Mundo (MDM)** representa su entorno; otros modelos —del factor humano, regulatorio, económico— representan otros aspectos. Todos son modelos contribuyentes.
- **Estado Cognitivo Empresarial (ECE).** La comprensión viva y unificada del estado de la organización y su entorno, integrada a partir de los modelos. Es un **mecanismo** (no la identidad del sistema).
- **Afirmación.** La unidad mínima de contenido que SOEC sostiene. Cada afirmación porta su tipo, su alcance inferencial, su régimen de establecimiento, su justificación y sus supuestos.
- **Evidencia.** Todo elemento examinable que sostiene o debilita una afirmación, con su procedencia.
- **Historia epistemológica.** El registro de los eventos por los cuales las afirmaciones nacieron, cambiaron de estado o fueron revisadas. El estado actual del conocimiento es una proyección sobre ella.

### Plano de la Apropiación *(donde vive el propósito de SOEC)*

- **Comprensión organizacional.** La comprensión de la realidad efectivamente incorporada por la organización: viva, unificada, explicable y transmisible. Es lo que SOEC existe para preservar, ampliar y transmitir.
- **Persona.** El sujeto humano que comprende, decide y gobierna. **Conceptualmente presente pero exterior al sistema**: SOEC la sirve y la amplía; no la contiene ni la reemplaza.

---

## II. Relaciones — ¿cómo se conectan estas entidades?

Relaciones estructurales, no procesos.

- **Modelo → *representa* → aspecto de la Realidad.** El MED representa la Empresa; el MDM representa el Mundo. La relación es de representación, nunca de identidad.
- **ECE ← *se integra a partir de* ← Modelos.** El ECE no contiene a los modelos ni es uno más: los integra en una comprensión única. La relación es de composición cognitiva.
- **Afirmación ← *pertenece a* ← una Representación**, y **→ *se sostiene en* → Evidencia.** Ninguna afirmación existe suelta: siempre es atribuible a la representación que la produjo.
- **Historia epistemológica → *registra eventos sobre* → Afirmaciones**, y **ECE ← *es proyección de* ← Historia.** El estado presente se deriva de la historia; la historia no se deriva del estado.
- **Comprensión organizacional ← *se apropia de* ← Representaciones.** La apropiación es la relación que atraviesa del plano de la Representación al de la Apropiación.
- **Brecha ← *es indicador derivado de* ← ECE.** La distancia entre cómo es el mundo (MDM) y cómo está la empresa (MED) es el principal indicador del ECE; es una relación medida, no una entidad.
- **Persona → *orienta su decisión con* → ECE**, y **→ *cierra* → el ciclo.** SOEC orienta; la persona decide; su decisión y la evolución de la realidad reingresan como nuevos eventos.

---

## III. Límites conceptuales — ¿dónde termina cada concepto?

El bloque que impide que un concepto invada otro. Cada límite deriva de una condición ya ratificada.

- **Realidad ╪ Representación.** SOEC nunca posee la realidad; sostiene representaciones de ella. Un modelo no es aquello que representa. *(K-1, No Confusión.)*
- **ECE ╪ Identidad de SOEC.** El ECE es el mecanismo central, no la definición del sistema. SOEC no *es* el ECE. *(Const. 2.6.)*
- **Modelo ╪ ECE.** Un modelo representa un aspecto; el ECE integra la comprensión del todo. El ECE no es un modelo más, y ningún modelo es el ECE.
- **Representación (tener) ╪ Apropiación (saber).** Que SOEC sostenga una representación no equivale a que la organización la comprenda. *(K-5.)*
- **Evidencia ╪ Afirmación.** La evidencia sostiene o debilita; no es, por sí misma, aquello que se afirma.
- **Conocimiento ╪ Reconocimiento.** Lo que SOEC puede detectar sin poder explicar es reconocimiento, no conocimiento apropiado. *(Frontera de #3.)*
- **SOEC ╪ Persona.** La comprensión y la orientación pertenecen a SOEC; el juicio, la decisión y la responsabilidad pertenecen a la persona. Es el límite exterior del sistema, y no se traslada porque SOEC mejore. *(Const. 2.4, Soberanía Humana.)*
- **Arquitectura conceptual ╪ sustrato técnico.** Todo lo descrito en este documento vive por encima de cualquier tecnología que lo realice. El motor que calcula el ECE es un órgano reemplazable; el ECE, como concepto, no. *(Independencia Tecnológica, Const. 2.5.)*

---

## IV. Ciclos conceptuales — ¿cómo evoluciona el conocimiento?

Ciclos propios del conocimiento, no flujos de trabajo.

### Ciclo de maduración de una afirmación

Una afirmación puede recorrer grados de madurez: **dato → reconocimiento → hipótesis → conocimiento**. Son grados, no una secuencia obligatoria: una afirmación puede incorporarse ya madura.

### Ciclo de vida de una representación

Toda representación atraviesa, conceptualmente: **nacimiento** (incorporación) → **maduración** → **consolidación** → **caducidad o archivo** → **sustitución o recuperación**. Ninguna etapa borra las anteriores: cambia el estado, no la historia.

### Ciclo perpetuo del sistema

Sobre el ECE opera, sin fin, el ciclo **Comprender → Aprender → Adaptarse → Orientar → Comprender de nuevo**. El ciclo no actúa sobre la realidad directamente, sino sobre el Estado Cognitivo; **su lazo se cierra a través de la decisión humana** y del cambio del mundo, que reingresan como nuevos eventos en la Historia epistemológica.

---

## V. Invariantes — ¿qué debe cumplirse siempre?

Propiedades estructurales de la arquitectura conceptual, no normas de gobierno. Una implementación que viole cualquiera de ellas no es una implementación de SOEC.

1. **Atribución.** Toda afirmación es atribuible a la representación que la produjo, su propósito y sus supuestos. SOEC no afirma en primera persona sobre el mundo.
2. **Declaración de la representación.** Toda representación declara qué representa, para qué, qué excluye y bajo qué supuestos.
3. **Transporte.** El tipo, el alcance y el régimen de una afirmación viajan con ella a través de toda derivación; no se pierden ni se elevan sin justificación.
4. **Historia inmutable.** El estado del conocimiento es una proyección sobre una historia de eventos que no se sobrescribe.
5. **Separación de planos.** Ninguna entidad pertenece simultáneamente a dos planos: lo que es Realidad no es Representación, y lo que es Representación no es Apropiación.
6. **Comprensión viva permanente.** Existe siempre una comprensión viva y unificada del estado de la organización y su entorno. Su encarnación (el ECE) puede evolucionar; el requisito, no.
7. **Explicabilidad.** Todo lo que el sistema sostiene puede ser seguido por una persona; no hay comprensión apropiada sobre lo inexplicable.
8. **Revisabilidad.** Ninguna representación empírica es definitiva.
9. **Cierre humano del ciclo.** El ciclo perpetuo nunca se cierra dentro del sistema: se cierra a través de la persona que decide.
10. **Independencia del sustrato.** La arquitectura conceptual es completa y coherente con independencia de la tecnología que la realice.
11. **Simetría de los modelos.** Todos los modelos fundamentales comparten la **misma anatomía conceptual**; lo que cambia entre ellos es el **dominio que representan**, no la estructura con la que representan. El ECE opera así sobre una familia coherente de modelos, no sobre arquitecturas distintas.
12. **Marco e instanciación.** Cada modelo define una **estructura universal de representación** (un marco extensible); las organizaciones concretas **instancian** esa estructura con su contenido. El marco es parte de la definición del modelo; el contenido instanciado, no. Un modelo *representa*; no *enumera*.

---

**Continuidad.** Este documento sitúa las entidades del sistema, sus relaciones, sus límites, sus ciclos y sus invariantes. **No las desarrolla por dentro**: el interior del MED vive en #10, el del MDM en #11, el del Cerebro Empresarial en #12, el del Sistema de IA en #13, y las capacidades en #14. Su arquitectura técnica y su implementación viven en #16. Ninguna entidad descrita aquí se redefine allí: se desarrolla dentro de los límites que este mapa establece.
