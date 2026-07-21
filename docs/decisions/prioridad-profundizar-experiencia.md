# Instanciación Estratégica — Profundizar la experiencia antes de expandir

> **Registro de instanciación** (no declara arquitectura). Emitido por la **Autoridad Estratégica (#6)** conforme al **Roadmap #17 §5** (priorización reservada a la Autoridad, registrada como instanciación y justificada contra la arquitectura).

- **Fecha:** 2026-07-21 · **Estado:** ✅ Emitida. Refina el «siguiente nodo» de `docs/decisions/prioridad-primera-interfaz.md`.

## Contexto

Cerrado F1-UI-01 (primera interfaz consumidora de capacidades, sobre la cadena real), el proyecto **cambia de etapa**: su calidad ya no depende principalmente de la arquitectura interna, sino de cómo esa arquitectura se traduce en una experiencia útil, comprensible y confiable para quien decide. El informe de cierre listó el siguiente nodo como «efectos externos, conectores, autenticación y otras capacidades … reservados a la Autoridad» — correcto en gobernanza, pero **demasiado amplio**.

## Decisión

**El siguiente gran objetivo es PROFUNDIZAR Y CONSOLIDAR la experiencia del usuario sobre las capacidades ya existentes — cómo las personas interactúan con SOEC — ANTES de ampliar el número de capacidades, introducir conectores, automatizaciones o efectos externos.**

Orden de prioridad registrado:

1. **Profundizar la experiencia** sobre lo ya construido (capacidad «Comprender el estado» y las operaciones que compone).
2. Recién después: nuevas capacidades / nuevos dominios.
3. Solo entonces, y con autorización explícita: conectores, autenticación, efectos externos, automatizaciones — preservando siempre la frontera **Producto → Decisión humana → Acción**.

## Oportunidades registradas (dirección de producto; NO órdenes de ejecución)

Se registran para no perderse; su ejecución concreta es instanciación estratégica futura.

- **A · La experiencia como conversación.** Evolucionar «Comprender el estado» hacia un recorrido narrativo —*«Cuéntame qué está pasando en mi empresa»*— que responda: qué observó · por qué lo considera relevante · qué evidencia encontró · qué no puede afirmar · qué necesita validar la persona. Secuencia: **Resumen conversacional → Evidencia → Detalle técnico**. No reemplaza la interfaz actual (informe estructurado por preguntas humanas + trazabilidad progresiva): la **enriquece**.
- **B · Sesión multi-capacidad.** Permitir combinar varias capacidades en una misma sesión (p. ej. Comprender el estado → Detectar oportunidades → Anticipar escenarios → Orientar alternativas) **sin perder nunca la trazabilidad individual de cada capacidad** ni la separación de sus productos. Requiere primero instanciar esas capacidades (instanciación estratégica) y respeta la no-inversión de la jerarquía (#14 §2).

## Justificación contra la arquitectura

- **Universalidad progresiva (#17 §4):** consolidar en profundidad antes de ampliar en superficie.
- **Reversibilidad y carga de la prueba (#4):** quien proponga saltar a efectos/automatizaciones asume la carga; profundizar la experiencia es reversible y de menor riesgo.
- **Soberanía (Const. 2.4):** toda evolución de la experiencia conserva `bindingDecision: false`, ausencia de acciones y decisiones reservadas a la persona.

## Charter del próximo bloque — F2-UX-01 «Experiencia Cognitiva» (registrado, NO iniciado)

Nombre y objetivo fijados por la Autoridad Estratégica para cuando se abra el bloque. **No es «mejorar la UI»**: es diseñar **cómo SOEC comunica conocimiento**.

> **Pregunta rectora:** ¿Cómo debe conversar una persona con SOEC para comprender mejor su empresa **sin perder trazabilidad ni soberanía**?

**Cuatro principios de diseño** (realizan invariantes congelados; no crean arquitectura):

1. **Comprensión antes que información** — la pantalla ayuda a *entender*, no solo a mostrar datos (realiza anti-atrofia y explicabilidad, #13/#14 inv. · #9 inv. 7).
2. **Progresividad** — visión simple primero; el usuario profundiza hasta la evidencia técnica cuando lo necesita (ya iniciado como trazabilidad progresiva en F1-UI-01).
3. **Transparencia** — cada afirmación importante se rastrea hasta su origen, dejando siempre claro **qué sabe el sistema, qué no sabe y qué debe decidir la persona** (realiza atribución, procedencia y frontera de soberanía).
4. **Fidelidad** — *la forma de comunicar nunca puede alterar el significado del conocimiento que comunica.* Una narrativa puede reorganizar, simplificar, resumir y adaptar el lenguaje; **nunca** aumentar la certeza, eliminar limitaciones, ocultar contradicciones, inventar relaciones, suavizar abstenciones ni convertir una orientación en recomendación vinculante. Es el puente entre la arquitectura y la experiencia. (Realiza Transporte #9 inv. 3, No eleva la certeza #13 inv. 3, Hereda el alcance #14 inv. 4, Explicabilidad #14 inv. 5.)

## Restricción arquitectónica del bloque — La narrativa es una VISTA, no una fuente

> **Toda narrativa producida por SOEC es una representación del conocimiento existente, nunca una fuente nueva de conocimiento.**

Encuadre de gobernanza: se registra como **realización/interpretación** de invariantes ya congelados (Transporte #9 inv. 3; No eleva la certeza #13 inv. 3; Hereda el alcance #14 inv. 4; Explicabilidad #14 inv. 5), **no** como enmienda a la Fundación. Elevarlo a norma constitucional universal formalmente declarada exigiría el circuito #8→#6→#7→#5 y demostrar laguna/contradicción — innecesario, porque el invariante de Transporte ya lo establece. Queda pendiente de decisión explícita de la Autoridad si desea esa formalización universal.

Separación conceptual de capas de F2-UX-01:

```text
Capacidad → Producto compuesto → Narrativa conversacional → Interfaz
```

La **Narrativa conversacional no posee conocimiento propio**. Su única responsabilidad es transformar un producto estructurado en discurso humano **conservando exactamente**: evidencia · procedencia · incertidumbre · limitaciones · información faltante · decisión reservada a la persona.

Consecuencias verificables (para cuando se abra el bloque):

- el resumen conversacional **expresa** conclusiones existentes; no las **genera**;
- cada frase importante se rastrea a un producto intelectual existente;
- ante *«¿por qué dices eso?»*, la respuesta surge de la **misma cadena de evidencia**, no de una generación independiente;
- sin evidencia suficiente, la conversación **lo dice explícitamente**; no rellena vacíos;
- la conversación debe ser **equivalente** al producto intelectual subyacente, solo en lenguaje más natural (evita que la explicación difiera del razonamiento ejecutado).

**Consecuencia buscada:** si esta experiencia se resuelve bien, las futuras capacidades (Anticipar, Orientar, …) se incorporan **de forma natural**, sin rediseñar la interacción desde cero. **Condición:** el bloque se abre por decisión explícita de la Autoridad; su ejecución respeta la capa conceptual congelada y los pilares de soberanía.

## Trazabilidad

#4 · #6 · #13/#14 (anti-atrofia, explicabilidad) · #16 (experiencia = realización) · #17 §4-§5. Complementa `docs/decisions/prioridad-primera-interfaz.md`. Ninguna cláusula modifica la Fundación.
