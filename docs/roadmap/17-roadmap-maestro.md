# Roadmap Maestro — SOEC

> **Documento #17 de la Biblioteca Maestra.** Capa de Ejecución. Competencia primaria: **secuenciar la construcción**.
>
> **Pregunta que responde:** ¿En qué orden, con qué dependencias y bajo qué criterios de avance se construye SOEC sobre la Fundación ya consolidada?
>
> **Lo que este documento NO gobierna:** los principios, el dominio, la arquitectura ni la tecnología (→ #1–#16). **No introduce ninguna decisión arquitectónica ni técnica nueva:** ordena en el tiempo la construcción de lo ya definido.

- **Versión:** 1.0 · **Fecha:** 2026-07-19 · **Estado:** 🔵 En revisión.

---

## 1. Principio del roadmap

La construcción sigue el **orden de dependencia de la arquitectura**, no la preferencia ni la urgencia. Reaparece aquí la regla constitucional *Fundación antes que Implementación* (Art. 3): primero el conocimiento, después el código; y ningún elemento se construye antes que aquello de lo que depende.

## 2. Fases de construcción

Derivadas del grafo de dependencias congelado (#9–#14) y de la estratificación técnica (#16). Cada fase construye sobre la anterior.

| Fase | Construye | Depende de |
|---|---|---|
| **0 — Fundación** | La Biblioteca Maestra (#1–#19) | — *(en cierre)* |
| **1 — Base técnica** | Las estructuras Nivel A tras sus fronteras: almacén event-sourced, atribución, historia inmutable, frontera de soberanía | Fundación |
| **2 — Modelos** | Instanciación del MED y el MDM para un primer dominio | Base técnica |
| **3 — Integración** | El ECE: integración de los modelos, brecha, consistencia | Modelos |
| **4 — Operaciones** | Las operaciones intelectuales sobre el ECE | ECE |
| **5 — Capacidades** | Composición de operaciones en capacidades al servicio de personas | Operaciones |
| **6+ — Extensión** | Nuevos modelos, operaciones y capacidades sobre el marco extensible | Capas previas conformes |

Ninguna fase invierte este orden: no hay capacidades sin operaciones, ni operaciones sin ECE, ni ECE sin modelos, ni modelos sin la base técnica que los sostiene.

## 3. Criterios de avance

- Una fase **se considera completa** solo cuando su implementación **supera los estándares de conformidad del #15** y su verificación (fase 6 del método, #7). No basta con que funcione.
- Una fase **no comienza** antes de que aquello de lo que depende sea conforme.
- El avance se declara con **honestidad de estado** (Art. 5.6): lo verificado como verificado, lo pendiente como pendiente.

## 4. Principios de secuenciación

- **Universalidad progresiva** (principio estratégico ya ratificado): la construcción comienza en un **primer dominio** donde la complejidad y el impacto humano hacen más evidente la necesidad, y se generaliza desde ahí. La implementación es progresiva; la visión, universal.
- **Reversibilidad y carga de la prueba** (#4): se prefieren pasos reversibles; quien propone adelantar, alterar o saltar una fase asume la carga de justificarlo.
- **Incremental y verificable** (#7): cada fase avanza en pasos comprobables, no en saltos.

## 5. Instanciación estratégica

Este documento fija la **estructura y los criterios** del roadmap. La **priorización concreta** —qué dominio inicial, qué capacidades primero, qué hitos y qué fechas— es una **decisión de la Autoridad Estratégica** (#6), que se registra como instanciación y se justifica contra la arquitectura. El roadmap define el orden y las puertas; no fija fechas por sí mismo.

---

**Continuidad.** Este documento ordena la construcción; el **modo de trabajo diario** que la ejecuta vive en #18, y la **autorización formal de inicio** en #19. Ninguna fase de este roadmap puede introducir arquitectura nueva: toda construcción es realización de lo ya congelado, verificada contra el #15.
