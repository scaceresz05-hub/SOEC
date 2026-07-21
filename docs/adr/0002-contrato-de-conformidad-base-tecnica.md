# ADR-0002 — Contrato de Conformidad de la Base Técnica (Nivel A)

- **Estado:** ✅ **ACEPTADO.** Deriva directamente de la arquitectura congelada; es **Nivel A** (estructura, no producto) y **no depende del stack** (ADR-0001).
- **Fecha:** 2026-07-19 · **Fase:** 1 — Base Técnica.

## Contexto

La Base Técnica realiza las estructuras Nivel A del #16, verificables por los estándares del #15. Este ADR fija **el contrato** —los comportamientos exigidos— que **cualquier** implementación debe satisfacer, con independencia del stack que se elija. Es la vara de conformidad contra la que se verificará el código.

## Decisión — contratos por estructura Nivel A

### C-1. Almacén event-sourced *(realiza: Almacén de representaciones, #16)*

- **Append-only:** los hechos se agregan; **nunca se sobrescriben ni se editan** en su lugar.
- **Estado como proyección:** cualquier estado (de un modelo, del ECE) se **deriva** de la secuencia de eventos; no se almacena como verdad mutable.
- **Reconstrucción temporal:** debe poder responderse *«¿qué se sostenía en la fecha T?»* proyectando solo los eventos hasta T, **sin contaminación posterior** (no retroyección, #3/E3).
- *Verificación (#15):* solicitar el estado en una fecha pasada y comprobar que se reconstruye sin datos posteriores.

### C-2. Atribución de toda afirmación *(realiza: invariante #9.1)*

- Toda afirmación almacenada porta: **fuente/procedencia, propósito, supuestos, tipo, alcance inferencial, régimen de establecimiento e incertidumbre declarada**.
- Ninguna afirmación existe sin atribución; el sistema **no afirma en primera persona sobre el mundo**.
- *Verificación (#15):* tomar cualquier afirmación y exigir su cadena de atribución completa; falla si falta algún campo.

### C-3. Historia inmutable y corrección enlazada *(realiza: invariante #9.4, E3)*

- Las correcciones son **nuevos eventos enlazados** al anterior; **no** ediciones retroactivas.
- El testimonio se conserva como declarado; toda interpretación es una afirmación derivada, separada y enlazada.
- *Verificación (#15):* comprobar que corregir una afirmación conserva la original y registra la relación.

### C-4. Transporte y no-elevación del alcance *(realiza: invariante #9.3, #3, #12)*

- El tipo, el alcance y el régimen **viajan con cada afirmación** a través de toda derivación.
- El alcance **no se eleva sin un evento de elevación justificado y registrado**; integrar o componer no incrementa la certeza por sí solo.
- *Verificación (#15):* seguir una afirmación asociativa por varias derivaciones y comprobar que no emerge como causal sin evento de elevación.

### C-5. Frontera de soberanía *(realiza: Const. 2.4, #13, #14)*

- **Estructural:** ningún camino del sistema cierra una decisión reservada al juicio humano; todo producto termina **ofrecido a una persona**.
- Toda operación/capacidad puede **abstenerse** («no sé» es salida legítima) y **declara su incertidumbre**.
- *Verificación (#15):* rastrear todo curso que produzca un efecto y comprobar que la decisión vinculante es humana; falla cualquier cierre automático de decisión reservada.

## Consecuencias

- Todo stack elegido en ADR-0001 **debe satisfacer estos cinco contratos**; ninguno es negociable por comodidad de implementación.
- Estos contratos son la **especificación de aceptación** de la Base Técnica: la fase no está completa hasta que cada uno se verifica (#15 + #7 fase 6).
- Son **tech-neutral**: cambiar de stack re-instancia las medidas, no los contratos.

## Trazabilidad

#9 (invariantes 1, 3, 4, 5, 7, 9) · #12 · #13 · #15 (estándares de conformidad) · #16 (estructuras Nivel A). Ninguna cláusula redefine estos documentos; los realiza.
