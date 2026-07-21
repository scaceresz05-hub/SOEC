# ADR-0007 — Primer dominio real (pyme de servicios) y primera capacidad instanciados como contenido (F1-RM-01)

- **Estado:** ✅ **ACEPTADO.** Realiza la instanciación estratégica registrada en `docs/decisions/instanciacion-estrategica-primer-dominio.md` (#17 §5). No introduce arquitectura nueva.
- **Fecha:** 2026-07-21 · **Bloque:** F1-RM-01.

## Contexto

F1-RM-01 resolvió el grafo del Roadmap #17: cerradas las fases 1–5 a nivel de marco, el siguiente nodo (Fase 2 «para un primer dominio» / Fase 6 Extensión) estaba reservado a la Autoridad Estratégica (#17 §5). La Autoridad decidió: **dominio inicial = pyme de servicios genérica**, **primera capacidad = «Comprender el estado»** (esclarecer + detectar), **datos = solo sintéticos**. Con la decisión tomada, el nodo pasa a técnico e inequívoco.

## Decisión técnica

### D-1. El dominio es CONTENIDO de instanciación, no arquitectura *(Nivel C)*

- Se crea el paquete `@soec/instancia-pyme` que instancia el marco MED/MDM ya congelado mediante los **servicios públicos** (no toca tablas, no importa el event store: prueba arquitectónica). **No añade ninguna migración**: la verificación confirma que la migración desde cero aplica solo los cinco esquemas existentes (`0001`…`0005`). El dominio vive sobre el esquema existente.
- Las entidades de la pyme (unidades, procesos, ofertas, recursos, objetivos / competencia, normas, mercado) son **tipos de instancia**, no conceptos de primer nivel (#10 §2).

### D-2. La primera capacidad real es una definición REGISTRADA, no un fixture *(Nivel C)*

- «Comprender el estado» se registra y publica en el `CapabilityRegistry` como definición versionada (familia #14 §4), compone las operaciones existentes (detectar + esclarecer) por el `OperacionesPort`, entrega un producto compuesto **no vinculante** y **no ejecuta efectos**. Es una instancia sobre el sistema, no una excepción arquitectónica (orden §8).

### D-3. Frontera de soberanía y sintética preservada *(Nivel A, heredado)*

- La capacidad termina antes de la decisión humana (`bindingDecision: false`), conserva contradicciones abiertas y faltantes, y remite al juicio de la persona. Sin conectores, sin interfaz, sin datos ni credenciales reales (verificado por prueba arquitectónica).

## Consecuencias

- Existe la primera vertical de dominio **real** end-to-end (MED+MDM pyme → ECE → capacidad «Comprender el estado» → producto compuesto), verificada con PostgreSQL real y worker.
- Nuevas capacidades (Anticipar/Orientar/Preservar) o un nuevo dominio son **nueva instanciación estratégica**: se deciden y registran cuando la Autoridad y el Roadmap lo determinen.

## Trazabilidad

`docs/decisions/instanciacion-estrategica-primer-dominio.md` · #6 · #10/#11 (marco MED/MDM) · #12 (ECE) · #13 (esclarecer/detectar) · #14 (familia «Comprender el estado») · #17 §4-§5 · ADR-0003..0006. Ninguna cláusula modifica la Fundación ni introduce arquitectura.
