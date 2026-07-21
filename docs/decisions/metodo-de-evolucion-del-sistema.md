# Método de Evolución del Sistema — cómo cambia SOEC sin perder coherencia

> **Síntesis / guía** (no norma vinculante). Consolida disciplinas ya practicadas y registradas; no declara reglas nuevas. Realiza el Principio Rector: *el activo más importante de SOEC es el conocimiento que define cómo su código debe evolucionar.*

- **Fecha:** 2026-07-21 · **Estado:** ✅ Registrado como guía capstone. Índice de precedentes, no fuente normativa.

## Cinco disciplinas consolidadas

1. **La arquitectura se amplía por instanciación, no por rediseño continuo.** Un nuevo dominio o capacidad es contenido sobre el marco congelado, no arquitectura nueva. *(Precedente: ADR-0007, `instanciacion-estrategica-primer-dominio.md`.)*
2. **La experiencia evoluciona profundizando la comunicación del conocimiento**, sin ocultar la arquitectura ni sustituir la evidencia. *(Precedente: F1-UI-01, `prioridad-profundizar-experiencia.md`.)*
3. **Se prefiere la interpretación a la enmienda** siempre que la Fundación ya permita derivar la respuesta. *(Precedente: «narrativa como vista», `criterio-interpretacion-vs-enmienda.md`.)*
4. **Toda modificación constitucional exige justificación demostrable**, no solo una buena idea (test de cuatro preguntas). *(Precedente: `criterio-interpretacion-vs-enmienda.md`.)*
5. **La priorización estratégica se registra como instanciación** (#17 §5) antes de ejecutarse; una buena idea no se convierte automáticamente en trabajo.

## Orden normal de evolución

```text
Fundación → Arquitectura → Instanciación → Experiencia → Interpretación
```

La necesidad práctica primero se busca **dentro** de los principios existentes (interpretación), en lugar de modificar la teoría cada vez que aparece.

## Sólo ante laguna demostrable

```text
Interpretación → ¿laguna real? → Sí (las 4 preguntas) → Enmienda constitucional (#8→#6→#7→#5)
```

Si alguna de las cuatro preguntas es «no», la vía correcta es interpretación · charter · guía, sin tocar la Constitución.

## Distinción que el método preserva

Ante cualquier propuesta, distinguir explícitamente:

- una **nueva idea** (dirección; se registra, no se ejecuta);
- una **nueva implementación** (instanciación sobre el marco);
- una **nueva interpretación** (hace explícita una consecuencia de invariantes existentes);
- una **verdadera necesidad de enmendar** la Constitución (las cuatro preguntas en «sí»).

Esta distinción evita que la Biblioteca crezca por acumulación de principios redundantes y que la arquitectura se rehaga por cada necesidad práctica.

## Alcance

Guía capstone que **indexa** decisiones ya registradas; su valor es hacer legible el método, no crear obligación. Como el criterio de cuatro preguntas, permanece interpretativa: formalizar cualquiera de estas disciplinas como norma vinculante requeriría el circuito que ellas mismas describen.

## Trazabilidad

Principio Rector · Const. Art. 3 (Fundación antes que Implementación) y Art. 8 (permanencia) · #7 (método) · #9 inv. 12 (marco/instanciación) · #17 §4-§5 · `docs/decisions/*`. Ninguna cláusula modifica la Fundación.
