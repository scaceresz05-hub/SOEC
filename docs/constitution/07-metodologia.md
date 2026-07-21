# Metodología de Desarrollo — SOEC

> **Documento #7 de la Biblioteca Maestra.** Competencia primaria: **ejecutar**.
>
> **Pregunta que responde:** ¿Cuál es el procedimiento permanente mediante el cual cualquier cambio del proyecto se vuelve **legítimo, reproducible y verificable**?
>
> **Lo que este documento NO gobierna:** las reglas que se aplican (→ #1, #3, #4), quién tiene competencia para decidir (→ #6), el registro de permanencia (→ #5), **cómo se demuestra objetivamente que el método se cumplió** (→ #15) y **cómo se ejecuta el método con herramientas concretas** (→ documentos operativos, fuera de la capa constitucional).
>
> Este documento **no describe cómo se desarrolla software: describe cómo evoluciona legítimamente SOEC.**

- **Versión:** 1.0 · **Fecha:** 2026-07-19 · **Estado:** ✅ **ACEPTADO.** Todo cambio posterior sigue el Art. 8 de la Constitución y este mismo método (§7).

---

## 1. Principio de Independencia Instrumental

> La metodología gobierna la transformación legítima del proyecto y es **independiente de herramientas, tecnologías, plataformas, lenguajes, proveedores o estructuras organizacionales concretas**. Toda herramienta constituye una **implementación contingente** del método y puede sustituirse sin modificar su validez.

Este principio es el guardarraíl del documento: si una sección de este texto dejara de ser válida por la desaparición de una herramienta, esa sección no pertenece aquí.

## 2. Qué es una transformación

Una **transformación** es cualquier cambio del proyecto, sea cual sea su materia: código, arquitectura, datos, configuración, documentación, decisiones, reglas, la propia Constitución o esta metodología. El método es el mismo para todas; **lo que varía es su profundidad, no sus fases** (§4).

Este documento se aplica, por tanto, a toda evolución del proyecto y no únicamente a la construcción de software.

**Transformación y decisión no son sinónimos.** Una **decisión** es un *acto*; una **transformación** es su *resultado*. Este método gobierna el tránsito entre ambos: qué debe ocurrir para que una decisión legítima produzca una transformación legítima.

## 2.bis. Circuito de transformación

Toda transformación recorre el mismo circuito. El método de este documento ocupa un tramo de él, no su totalidad:

```
Propuesta → #8 deliberación → #6 decisión competente → #7 ejecución → #15 verificación
                                                                    ↘ #5 sincronización al cierre
```

**Profundidad sobre una misma materia:** **#1 declara · #4 interpreta · #7 ejecuta · #15 comprueba.** Todo invariante constitucional atraviesa las cuatro profundidades; ningún invariante se reparte entre documentos. El #4 responde *qué nunca debe dejar de hacerse*; el #7, *cómo se hace*; el #15, *cómo comprobamos que realmente se hizo*.

## 3. El método permanente

Siete fases. Cada una **ejecuta** una regla ya declarada; ninguna la crea.

| # | Fase | Qué exige | Ejecuta |
|---|---|---|---|
| 1 | **Observación** | Verificar el estado real antes de modificar. Nada se transforma sobre una suposición cuando el hecho puede comprobarse | #1 Art. 5.1 · #4 §3 |
| 2 | **Comprensión** | Determinar qué depende de aquello que se va a cambiar; actualizar el conocimiento antes que el artefacto | #1 Art. 5.3 · Art. 3 · #4 §2 |
| 3 | **Justificación** | Declarar necesidad, complejidad introducida, reversibilidad, impacto, deuda contraída y vía de reversión. La carga de la prueba recae en quien propone | #4 §2 |
| 4 | **Decisión competente** | Obtener la aprobación de la autoridad que posee competencia sobre esa materia. Nada se implementa por haber sido propuesto | #6 §2, §6 |
| 5 | **Implementación** | Ejecutar de forma incremental y verificable, en pasos comprobables | #1 Art. 5.2 |
| 6 | **Verificación** | Comprobar el resultado contra lo decidido. No se declara terminado lo que no se verificó *(el cómo comprobarlo pertenece a #15)* | #1 Art. 5.6 · #4 §3 |
| 7 | **Registro y sincronización** | Dejar rastro de qué se decidió, por qué y bajo qué supuestos; sincronizar la Custodia | #1 Art. 5.4 · #5 §2.1 |

## 4. Proporcionalidad del método

**Ninguna fase se omite. Su profundidad y formalidad son proporcionales al impacto y a la reversibilidad de la transformación.**

Corregir una errata y enmendar la Constitución recorren las mismas siete fases; en el primer caso la justificación es una línea y la decisión es inmediata, en el segundo son un procedimiento completo. La proporcionalidad **no autoriza a saltarse fases**: autoriza a ejercerlas con la profundidad que corresponde.

> Un método que exige lo mismo para todo termina siendo ignorado — y **un método ignorado es peor que ninguno**, porque produce la apariencia de gobierno sin su sustancia. Un método que permite omitir fases termina sin defensa. La proporcionalidad resuelve ambos riesgos.

*(Ejecuta: Responsabilidad Proporcional al Impacto y Reversibilidad, #4 §2.)*

## 5. Cierre de una transformación

Una transformación **no está completa cuando funciona**: está completa cuando **sus siete fases lo están**. Hasta entonces permanece en curso, cualquiera sea el estado del artefacto.

En cuanto a la fase 7: **cuando la transformación produzca efectos que deban preservarse como conocimiento permanente del proyecto, su cierre incluye el registro y la sincronización conforme al Documento #5. Cuando ello no resulte aplicable, el cierre se rige por el procedimiento competente.**

*(Ejecuta: Honestidad de Estado, #1 Art. 5.6 y #4 §3 — «no se declara terminado lo que no se verificó». Este documento no amplía el alcance de la regla de sincronización del #5: determina cuándo corresponde invocarla.)*

## 6. Tratamiento metodológico de la urgencia

El método **contempla la urgencia en lugar de ser violado por ella**. Un método sin salida declarada se incumple en la primera crisis, y ese incumplimiento se normaliza.

**Cuando una transformación deba ejecutarse bajo condiciones de urgencia, el procedimiento excepcional será el declarado por la autoridad competente (#6), y deberá respetar los límites constitucionales (#1 Art. 2.4) y las reglas de excepción vigentes (#4 §6).** Las condiciones de procedencia, los límites y los plazos de regularización no se declaran aquí: pertenecen a los documentos con competencia para legislarlas.

Lo que sí corresponde a este método: **las fases ejercidas de forma reducida se completan posteriormente. Mientras no lo estén, la transformación no está cerrada (§5)**, cualquiera sea el estado del artefacto.

## 7. Autoaplicación

Modificar esta metodología **es una transformación** y se rige por este mismo método. Su competencia corresponde a #6. Un método que se modificara al margen de sí mismo dejaría de ser un método.

## 8. Frontera con los Estándares y los documentos operativos

| Documento | Competencia |
|---|---|
| **#7 — Metodología** | Define el **método permanente** |
| **#15 — Estándares** | Define **cómo demostrar** que el método se cumplió |
| **Documentos operativos** | Definen **cómo ejecutar** el método con herramientas concretas |

En consecuencia, **no pertenecen a este documento** —ni a ningún documento de la capa constitucional— las herramientas, plataformas, sistemas de control de versiones, ramas, flujos de revisión, integración continua, plantillas, guiones, listas de comprobación específicas ni ningún artefacto instrumental. No por deficiencia, sino porque son **implementaciones contingentes del método** y no el método (§1).

## 9. Consolidado

| Fase | Qué garantiza | Qué impide |
|---|---|---|
| Observación | Que se actúe sobre el estado real | Transformar sobre una suposición |
| Comprensión | Que se conozca el impacto antes de causarlo | Cambios cuyo efecto se descubre después |
| Justificación | Que exista una razón declarada y auditable | Que el cambio se sostenga en la autoridad de quien lo propone |
| Decisión competente | Que apruebe quien puede aprobar | Que proponer equivalga a autorizar |
| Implementación | Que cada paso sea comprobable | Saltos grandes sin verificación intermedia |
| Verificación | Que lo hecho corresponda a lo decidido | Declarar terminado lo no comprobado |
| Registro y sincronización | Que la transformación quede reconstruible | Que el conocimiento del cambio se pierda con quien lo hizo |

---

**Continuidad.** Este documento ejecuta lo que la Constitución declara (#1) y los Principios Fundamentales interpretan (#4), bajo las competencias que asigna el Gobierno (#6), y su cumplimiento se comprueba mediante los Estándares (#15). No crea reglas ni asigna competencias.
