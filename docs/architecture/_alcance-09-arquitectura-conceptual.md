# Mapa de alcance — Documento #9: Arquitectura Conceptual

> **Solo alcance. Ningún contenido arquitectónico se redacta aquí.** Preparatorio, para validación antes de escribir el #9.

- **Fecha:** 2026-07-19 · **Estado:** 🔵 Alcance para validación.
- **Pregunta única (Art. 7.4):** ¿Cómo está organizado conceptualmente SOEC?
- **Competencia primaria (#6 §1.bis):** describir la arquitectura conceptual elegida. **No declara, no legisla, no implementa.**

## 1. Naturaleza del documento

**Arquitectura conceptual declarativa.** Describe el universo conceptual que toda implementación deberá respetar, con independencia de lenguaje, framework, base de datos, interfaz, motor de IA y arquitectura técnica.

- **Tiempo verbal: presente conceptual.** Describe el sistema como si ya existiera completamente. No usa «se implementará», «debería existir», «más adelante».
- **Relación con la Constitución:** la Constitución responde *cómo se gobierna SOEC*; el #9 responde *qué es SOEC*. Separación absoluta.

## 2. Estructura — cinco bloques

| Bloque | Pregunta | Contenido |
|---|---|---|
| **I. Ontología** | ¿Qué existe dentro de SOEC? | Entidades y conceptos, en su existencia conceptual — no su implementación |
| **II. Relaciones** | ¿Cómo se relacionan? | Dependencia, composición, especialización, referencia, pertenencia, ciclo — relaciones estructurales, no procesos |
| **III. Límites** | ¿Dónde termina cada concepto? | Fronteras entre entidades; qué pertenece a cada una y qué no. *(Bloque más importante.)* |
| **IV. Ciclos conceptuales** | ¿Cómo evoluciona el conocimiento? | Nacimiento, transformación, consolidación, archivo, sustitución — ciclos del conocimiento, no flujos de trabajo |
| **V. Invariantes** | ¿Qué debe cumplirse siempre? | Propiedades arquitectónicas permanentes — restricciones de la arquitectura conceptual, **no** normas de gobierno |

## 3. Entidades conceptuales candidatas

Derivadas de material **ya ratificado** (Constitución y Fase 0.D). El #9 las describe; no las inventa ni las re-declara.

| Entidad | Origen ratificado | Estatus constitucional |
|---|---|---|
| **Estado Cognitivo Empresarial (ECE)** | Const. 2.6 | Mecanismo (no identidad) |
| **Representación** | #3 §2 (tres niveles: realidad / representación / apropiación) | — |
| **Modelo** *(MED, MDM y otros)* | Const. 2.6 | Modelos contribuyentes; MED/MDM fundamentales |
| **Evidencia** | #3 §3 (elemento informativo → candidata → evaluada) | — |
| **Afirmación** *(con tipo, alcance, régimen, justificación)* | #3 §3 | — |
| **Evento de evolución epistemológica** | E3 / #3 §4 | — |
| **Condición / brecha** *(alineación empresa↔mundo)* | Const. 2.1, 2.6 | — |
| **Realidad · Empresa · Mundo** | Const. 2.1 | Polos externos; SOEC no los posee |

*Los cuatro estados de la ausencia, los ejes temporales, los tipos de justificación y los grados de recuperabilidad son propiedades de estas entidades, ya fijadas en #3 — el #9 las ordena espacialmente, no las redefine.*

## 4. Consistencia obligatoria — el #9 no puede contradecir

- **ECE es mecanismo, no identidad** (Const. 2.6): el #9 no puede elevarlo a definición del sistema.
- **No Confusión** (K-1): realidad, representación y apropiación son tres niveles distintos que el #9 no puede colapsar.
- **El conocimiento es representación** (#3 §2): el #9 describe *representaciones del conocimiento*, no conocimiento sobre el mundo en primera persona.
- **Capa de misión sobre capa de tecnología** (registrada en #5, Nivel III pendiente): la ontología conceptual es independiente del sustrato técnico.

## 5. Fuera de alcance — jurisdicción de otros documentos

| Excluido | Dónde vive |
|---|---|
| Criterios constitucionales, taxonomía de permanencia, autoridad, procedimiento | #1, #5, #6 |
| Metodología, Git, ciclo de transformación | #7, Art. 6 |
| Arquitectura técnica, patrones de código, estructura de carpetas | #16 |
| Decisiones de implementación, roadmap, backlog, planificación | #16, #17 |
| **Criterios para *decidir* la arquitectura** (frontera #4/#9) | #4 |
| Desarrollo pleno de MED / MDM / Cerebro / IA / Capacidades | #10–#14 |

## 6. Frontera fina con los documentos de dominio (#10–#14)

**Riesgo:** el #9 y los documentos #10–#14 pueden solaparse sobre MED, MDM, ECE y capacidades.

**Delimitación propuesta:** el **#9 sitúa** cada entidad en el mapa conceptual —su existencia, relaciones, límites e invariantes—; los **#10–#14 desarrollan** el interior de cada una. El #9 dice *«el MED existe, se relaciona así con el MDM, tiene estos límites»*; el #10 dice *«el MED por dentro es así»*. Es la misma relación que #4 (criterios) tiene con #9 (arquitectura), un nivel más abajo.

## 6.bis. Reglas ratificadas por el Director de Arquitectura (2026-07-19)

1. **Cinco bloques cerrados.** Un sexto exige demostrar que el contenido no cabe en ninguno.
2. **Entidades = conjunto mínimo derivado de documentos ratificados**, no lista abierta. El #9 no descubre ni inventa entidades: localiza, conecta, delimita. Una entidad nueva solo entra si se demuestra que ya estaba implícitamente declarada o que pertenece a otra capa.
3. **Cláusula de consistencia fortalecida:** el #9 **no puede redefinir** ninguna entidad ya declarada. Puede situarla, relacionarla, delimitarla y conectar sus invariantes; **no** cambiar su significado.
4. **Regla de las cuatro preguntas:** en el #9 ninguna entidad se explica internamente. Cada una responde **solo**: ¿existe? · ¿dónde está? · ¿con qué limita? · ¿con qué se relaciona? Toda pregunta de *cómo funciona / cómo se calcula / qué estructura interna tiene* → #10–#14 o #16.
5. **Prueba de calidad del #9:** eliminados los #10–#14, debe seguir entendiéndose *qué existe, dónde y cómo se conecta*; pero debe ser **imposible implementar** cualquier entidad leyendo solo el #9. Si se pudiera implementar, invadió otra capa; si el sistema no se entendiera sin él, cumplió su función.
6. **Regla-resumen de la frontera:** *el #9 establece el mapa; los #10–#14 desarrollan cada territorio del mapa.*

## 7. Para validación — ✅ VALIDADO 2026-07-19

1. ¿Los **cinco bloques** son el alcance correcto, o sobra/falta alguno?
2. ¿Las **entidades candidatas** (§3) son las correctas? ¿Alguna sobra o falta?
3. ¿Se acepta la **delimitación #9 / #10–#14** de §6 (situar vs. desarrollar)?
4. Confirmada la validación, se redacta el #9 completo en un bloque continuo.
