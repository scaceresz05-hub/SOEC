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

## Trazabilidad

#4 · #6 · #14 · #16 (experiencia = realización) · #17 §4-§5. Complementa `docs/decisions/prioridad-primera-interfaz.md`. Ninguna cláusula modifica la Fundación.
