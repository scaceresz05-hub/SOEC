# Modelo del Mundo (MDM) — SOEC

> **Documento #11 de la Biblioteca Maestra.** Capa de Dominio. Competencia primaria: **desarrollar el interior del MDM**.
>
> **Pregunta que responde:** ¿Qué es el MDM por dentro — qué representa del mundo y en qué se diferencia del MED?
>
> **Lo que este documento NO gobierna:** la ubicación del MDM en el mapa conceptual (→ #9), el interior del MED (→ #10), la integración de los modelos en el ECE (→ #12), la construcción del MDM mediante IA (→ #13), las capacidades (→ #14) y la implementación (→ #16).

- **Versión:** 1.0 · **Fecha:** 2026-07-19 · **Estado:** 🔵 En revisión.

---

## 0. Relación con el Documento #9

> Este documento desarrolla el interior de una entidad ya situada por el Documento #9. **Ninguna definición aquí contenida modifica su existencia, límites o relaciones arquitectónicas.**

- **Entidad que desarrolla:** *Modelo* → el **Modelo del Mundo (MDM)**, situado por el #9 en el **plano de la Representación**.
- **Límites que hereda:** Realidad ╪ Representación (el MDM **no es** el mundo), Modelo ╪ ECE, y la frontera MED ╪ MDM (dominios distintos).
- **Invariantes que respeta:** los del #9, con especial peso de **Simetría de los modelos (inv. 11)** y **Marco e instanciación (inv. 12)**.

## 1. Presunción de simetría con el MED

Por el **Principio de Simetría** (#9, inv. 11), el MDM comparte con el MED **la misma anatomía conceptual**. Por tanto, este documento **no vuelve a desarrollarla**: la hereda por remisión.

Se aplican al MDM, sin repetirlos, **idénticos** al #10:

- su **naturaleza** de Modelo (representación de un aspecto de la realidad, con la anatomía de toda representación);
- su condición de **marco extensible** que las organizaciones instancian (#10 §2);
- su **anatomía interna** —afirmaciones, entidades representadas, relaciones, ámbito declarado, historia— (#10 §3);
- su **ciclo de vida** —nacimiento, maduración, consolidación, caducidad, sustitución— (#10 §4);
- sus **invariantes internos**, con el dominio adaptado (#10 §5).

**Lo único que este documento desarrolla es lo que difiere por el dominio representado — el mundo, no la empresa.**

## 2. Qué representa el MDM — el dominio propio

El MDM representa el **entorno** en que la empresa existe: el *aspecto mundo* de la realidad. Su marco extensible cubre dimensiones distintas de las del MED:

- **Lo normativo** — leyes, regulaciones, obligaciones externas y su vigencia.
- **Lo económico** — condiciones económicas, mercados, precios, factores macro.
- **Los actores externos** — clientes, contrapartes, competencia, proveedores, autoridades: como entidades del mundo, no como vínculos de la empresa.
- **Lo tecnológico** — el estado y la evolución de las tecnologías relevantes.
- **Lo social y ambiental** — el contexto humano, territorial y ambiental.
- **Su dinámica** — cómo cada dimensión está cambiando, con independencia de la empresa.

Como en el MED, estas dimensiones son un **marco**: cada organización instancia el suyo según el mundo que le es relevante. Un SSR rural y un puerto instancian mundos distintos con el mismo MDM.

## 3. Tres diferencias esenciales respecto del MED

La simetría es estructural; el dominio impone tres diferencias que sí deben desarrollarse.

**Diferencia 1 — Ajenidad.** El MED representa algo sobre lo que la organización tiene autoridad; el MDM representa algo sobre lo que **no la tiene**. El mundo cambia con independencia de la empresa y de SOEC. Consecuencia interna: el MDM **nunca contiene afirmaciones que la empresa pueda cumplir o modificar por decisión propia** — solo representa lo que el mundo es. Que la empresa *responda* a una norma es materia del MED (su configuración); que la norma *exista y rija* es materia del MDM.

**Diferencia 2 — Acceso mediado y más débil.** La empresa puede observarse desde dentro; el mundo se observa de forma más indirecta y mediada. Consecuencia interna: en el MDM la **evidencia tiende a ser más débil, más incierta y más dependiente de fuentes externas**, y sus afirmaciones portan, en promedio, **mayor incertidumbre declarada** (aplicando las mismas reglas de evidencia y de incertidumbre ya fijadas en #3, sin excepción). El MDM no baja el estándar: reconoce que su dominio lo tensiona más.

**Diferencia 3 — Cambio autónomo.** El MED cambia cuando la empresa cambia, muchas veces por decisiones internas registrables; el MDM cambia por dinámicas externas que nadie dentro de la organización controla ni anuncia. Consecuencia interna: el MDM concede un peso especial a **detectar el cambio no informado** — el evento del mundo que ocurrió sin que nadie lo reportara (los cuatro estados de la ausencia, #3, aplican con particular fuerza aquí).

## 4. La frontera MED ╪ MDM, vista desde dentro

*(El #9 fijó la frontera; aquí solo se declara el criterio interno para ubicar una afirmación de un lado o del otro.)*

- Una afirmación pertenece al **MDM** si describe el mundo con independencia de la empresa: *«esta norma rige desde enero»*, *«el precio de este insumo subió»*.
- Pertenece al **MED** si describe la empresa o su configuración: *«la empresa aplica esta norma así»*, *«la empresa tiene este insumo en stock»*.
- Una misma situación real genera **dos afirmaciones distintas**, una por modelo, enlazadas pero no fusionadas (No Confusión). El MDM no representa cómo la empresa reacciona; el MED no representa por qué el mundo es como es.

## 5. Relación interna con el ECE

El MDM es, como el MED, un **modelo contribuyente**: alimenta el ECE. La **brecha** —principal indicador del ECE— se mide precisamente entre lo que el MDM representa (cómo es el mundo) y lo que el MED representa (cómo está la empresa). **Cómo** el ECE integra ambos y calcula esa brecha pertenece a #12; el MDM solo aporta su lado.

---

**Continuidad.** Este documento desarrolla el interior del MDM presumiendo su simetría estructural con el MED (#10) y desarrollando solo lo que difiere por su dominio. La integración con el MED en el ECE vive en #12; la construcción del MDM mediante IA, en #13; las capacidades, en #14; la implementación, en #16. Su instanciación para una organización concreta es trabajo de configuración.
