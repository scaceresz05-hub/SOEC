# Instanciación Estratégica — Prioridad: Primera Interfaz Consumidora de Capacidades

> **Registro de instanciación** (no declara arquitectura). Emitido por la **Autoridad Estratégica (#6)** conforme al **Roadmap #17 §5** (la priorización —qué capacidades primero, qué hitos— es decisión de la Autoridad, que se registra como instanciación y se justifica contra la arquitectura).

- **Fecha:** 2026-07-21 · **Estado:** ✅ Emitida.

## Contexto

Cerrado F1-RM-01 (primer dominio real + primera capacidad «Comprender el estado»), quedó completo y probado el arco **MED+MDM → ECE → Operaciones → Capacidades → Persona**. El informe de cierre listó tres caminos posibles de Fase 6+ (nueva capacidad · nuevo dominio · interfaz) de forma que podía leerse como equivalentes. La Autoridad Estratégica **corrige esa ambigüedad**.

## Decisión

**La siguiente prioridad es construir la primera interfaz consumidora de capacidades — la primera experiencia completa de usuario usando una capacidad real —, no agregar más dominios ni capacidades sintéticas.**

Razón: el riesgo técnico del proyecto ya está retirado (núcleo probado + primera instanciación real verificada). El mayor riesgo pasa a ser **la experiencia de uso**: demostrar que SOEC ayuda a una persona real, que es el objetivo último del sistema (autonomía intelectual).

## Verificación de gobernanza (#17)

- #17 **no gobierna** la interfaz ni la tecnología (encabezado: → #16); sus fases 1–6 secuencian capas conceptuales/dominio, **no** interfaces.
- «Ningún elemento se construye antes que aquello de lo que depende» (#17 §1): la interfaz **depende de capacidades**, ya conformes ⇒ **dependencia satisfecha**.
- La priorización es prerrogativa de la Autoridad Estratégica (#17 §5); pasos reversibles preferidos (#17 §4).
- **Conclusión:** #17 no impone una dependencia previa distinta; la primera interfaz es nodo válido y elegible.

## Contrato de la interfaz (heredado de la Fundación; no negociable)

La interfaz es **consumidora de capacidades**. Debe:
- consumir el producto de capacidad **por la API/servicios de capacidades**;
- presentar el **producto compuesto, la evidencia, la incertidumbre, lo faltante y los asuntos reservados al juicio humano**;
- no ocultar el proceso intelectual para simplificar visualmente.

No debe:
- acceder directamente a MED, MDM o ECE;
- invocar operaciones sin pasar por capacidades;
- incorporar lógica de dominio ni convertirse en fuente de verdad;
- **decidir por el usuario ni ejecutar acciones** (la persona es destino y autoridad final).

## Alcance de la primera interfaz (F1-UI-01, a ejecutar)

Primera experiencia completa: **ejecutar una capacidad real → visualizar su producto compuesto** con evidencia, incertidumbre, limitaciones, faltante, contradicciones abiertas, operaciones intermedias y **la decisión explícitamente reservada a la persona** (sin ejecutarla).

## Fuera de alcance (reservado)

Efectos externos, conectores, datos reales, credenciales, autenticación comercial, multitenencia comercial, editor de capacidades. Su priorización es nueva instanciación estratégica.

## Trazabilidad

#6 · #14 (capacidades) · #16 (realización técnica: interfaz Nivel C) · #17 §4-§5. Complementa `docs/decisions/instanciacion-estrategica-primer-dominio.md`. Ninguna cláusula modifica la Fundación.
