# Estándares de Desarrollo — SOEC

> **Documento #15 de la Biblioteca Maestra.** Capa Técnica. Competencia primaria: **verificar**.
>
> **Pregunta que responde:** ¿Cómo se comprueba **objetivamente** que una implementación respeta la arquitectura congelada?
>
> **Lo que este documento NO gobierna:** los principios (→ #4), el método (→ #7), la arquitectura conceptual y de dominio (→ #9–#14, **congelada**) y la arquitectura técnica e implementación concreta (→ #16). **No introduce ni reinterpreta ningún concepto arquitectónico:** los convierte en criterios verificables.

- **Versión:** 1.0 · **Fecha:** 2026-07-19 · **Estado:** 🔵 En revisión.
- **Profundidad documental:** **#4 principio · #7 método · #15 estándar verificable.** Este documento ocupa el tercer nivel y no invade los dos anteriores.

---

## 1. Premisa — la implementación se verifica contra la arquitectura

> **La implementación nunca tiene autoridad para modificar la arquitectura.** Si durante la construcción técnica aparece una dificultad, la primera obligación es **demostrar que existe una contradicción conceptual real** (Art. 3; congelamiento del Gate). No se adapta la arquitectura para facilitar el código: se verifica el código contra la arquitectura.

Estos estándares existen para hacer esa verificación **objetiva**, no para reabrir lo congelado.

## 2. Qué es un estándar en SOEC

Un **estándar** es un criterio **objetivo, verificable y auditable** que demuestra que una implementación respeta un principio o un elemento de la arquitectura:

- **Objetivo** — dos auditores independientes llegan al mismo veredicto.
- **Verificable** — existe un procedimiento que produce un sí/no o una medida.
- **Auditable** — quien no lo produjo puede comprobarlo (coherente con #6 §3.1: ninguna función se autoaudita).

Un estándar **deriva** de un principio; **nunca lo redefine**. Un estándar que contradijera un principio es inválido por construcción.

## 3. Estándares de conformidad arquitectónica

El núcleo del documento: cada invariante de la arquitectura congelada se convierte en un criterio verificable. La **medida concreta** (umbral, herramienta) se instancia cuando la tecnología quede fijada (#16); aquí se fija **qué debe ser demostrable y qué cuenta como conforme**.

| Invariante (fuente) | Estándar verificable | Cómo se audita |
|---|---|---|
| **Atribución** (#9 inv.1) | Todo resultado del sistema es rastreable hasta la representación, el propósito y los supuestos que lo produjeron | Tomar cualquier salida y exigir su cadena de atribución completa. Falla si alguna salida no la tiene |
| **No Confusión / separación de planos** (#9 inv.5, K-1) | Ninguna salida presenta una representación como si fuera la realidad | Toda afirmación sobre el mundo aparece marcada como *según tal representación*; falla si algo se presenta como hecho no atribuido |
| **Historia inmutable** (#9 inv.4) | El estado es proyección sobre eventos que no se sobrescriben; todo estado pasado es reconstruible | Solicitar el estado del conocimiento en una fecha pasada y verificar que se reconstruye sin contaminación posterior |
| **Explicabilidad** (#9 inv.7, Const. 2.4) | Todo producto puede ser seguido por una persona hasta su origen | Un auditor humano sigue la justificación de una salida de principio a fin sin recurrir al autor |
| **Soberanía Humana** (Const. 2.4; #13, #14) | Ningún camino del sistema cierra el lazo sin la persona; toda capacidad termina en un producto ofrecido al juicio | Rastrear todo curso que produzca un efecto y verificar que la decisión vinculante es humana. Falla si existe un cierre automático de decisión reservada |
| **Alcance transportado** (#9 inv.3; #3) | El tipo, el alcance y el régimen viajan con cada afirmación y no se elevan sin justificación registrada | Seguir una afirmación asociativa a través de derivaciones y verificar que no emerge como causal sin un evento de elevación |
| **La integración/operación no eleva la certeza** (#12, #13) | Componer o integrar no incrementa la confianza sin justificación independiente | Comparar la confianza declarada de un producto con la de sus insumos; falla si sube sin fuente independiente |
| **Anti-atrofia** (Const. 2.4; #14 inv.6) | Toda capacidad declara qué capacidad humana desarrolla, preserva o sustituye | Revisar la declaración de cada capacidad (Test de Decisión #4, q. 6 y 11); falla la que crea dependencia sin justificación |
| **Extensibilidad** (#9 inv.11–12) | Incorporar un modelo, operación o capacidad no rompe los existentes | Prueba de regresión conceptual: añadir un elemento y verificar que los invariantes de los demás se conservan |

## 4. Estándares de proceso y trazabilidad

Verifican que la transformación fue **legítima** (no solo que el resultado funciona), conforme al método (#7).

- **Fases completas.** Toda transformación registra que recorrió las siete fases del #7 con la profundidad proporcional a su impacto. Auditable por el registro de la transformación.
- **Sincronización.** Ninguna transformación se declara cerrada sin la sincronización de la Custodia que corresponda (#5 §2.1, #7 §5).
- **Deuda declarada.** Toda deuda contraída consta con su condición de saldo (#4 §3). Falla la deuda no registrada.
- **Excepción registrada.** Toda excepción a un principio o al método es explícita, acotada y con plazo (#4 §6, #7 §6).

## 5. Estándares de calidad

Derivados de los Principios Fundamentales (#4), medibles cuando la tecnología quede fijada.

- **Simplicidad exigible** (#4 §2) → toda complejidad añadida tiene justificación registrada; falla la complejidad sin dueño.
- **Comprensibilidad** (#4 §4) → el resultado es mantenible por alguien distinto de su autor dentro de un plazo declarado.
- **Arquitectura antes que funcionalidad** (#4 §2) → ninguna función se incorpora rompiendo el núcleo; auditable contra la estructura congelada.

## 6. Instanciación tecnológica

Este documento fija **qué debe ser verificable y qué cuenta como conforme**. Los **umbrales concretos y las herramientas** —cobertura, métricas de complejidad, integración continua, convenciones de código, criterios de rendimiento— son **instanciación** que se fija cuando la Arquitectura Técnica (#16) determine la tecnología. Un umbral concreto pertenece a la instanciación, no a este documento; cambiar de tecnología no invalida estos estándares, solo re-instancia sus medidas. *(Mismo patrón marco/instanciación que rige toda la arquitectura.)*

## 7. Invariantes de los estándares

1. **Derivan, no redefinen.** Todo estándar deriva de un principio o elemento arquitectónico; ninguno crea doctrina nueva.
2. **Objetivos.** Un estándar cuyo veredicto dependa de quién lo evalúa no es un estándar.
3. **Auditables por un tercero.** Ningún estándar se comprueba solo por su propio autor.
4. **Subordinados a la arquitectura.** Ante conflicto entre un estándar y un principio, prevalece el principio, y el estándar se corrige. La verificación nunca gobierna a lo verificado.

---

**Continuidad.** Este documento define cómo se comprueba objetivamente la conformidad con la arquitectura; **no** define la tecnología ni la implementación (→ #16), ni los principios (→ #4), ni el método (→ #7), ni la arquitectura (→ #9–#14, congelada). Convierte lo ya establecido en criterios verificables; su instanciación concreta espera a que la tecnología se fije.
