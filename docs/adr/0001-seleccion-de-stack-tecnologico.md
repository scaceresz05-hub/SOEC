# ADR-0001 — Selección de Stack Tecnológico (Nivel C)

- **Estado:** 🟥 **PENDIENTE DE DECISIÓN ESTRATÉGICA.** Reservada a la Autoridad Estratégica/Propietario (caso de parada #3 y #4 de la Directiva de Fase 1; reserva de selección Nivel C del #16 §6). **No se decide por iniciativa de la implementación.**
- **Fecha:** 2026-07-19 · **Fase:** 1 — Base Técnica.

## Contexto

La Fase 1 (Base Técnica) instancia las estructuras **Nivel A** del #16 con productos **Nivel C** tras sus fronteras estables. El #16 reserva la selección concreta de cada Nivel C a la autoridad competente, registrada y justificada contra la arquitectura. **Elegir el stack de un sistema pensado para veinte años es una decisión estratégica con consecuencias importantes** — precisamente los casos en que la Directiva de Fase 1 ordena detenerse.

## Ranuras Nivel C a decidir

| Ranura | Realiza (rol Nivel A) | Exigencia estructural que debe satisfacer |
|---|---|---|
| Lenguaje / runtime | Todo | Permitir realizar los contratos de ADR-0002 y ser mantenible |
| Almacén | Almacén de representaciones (#16) | Event-sourced, append-only, historia inmutable, atribución |
| Sustrato del órgano de operaciones intelectuales | #13 | **Reemplazable por diseño** (LLM / simbólico / híbrido); el más Nivel C de todos |
| Framework de composición | Compositor de capacidades (#14) | Componer operaciones hacia un propósito humano |
| Adaptadores de fuentes | Integrar→absorber (#10/#11) | Convertir sistemas externos en evidencia con procedencia |

## Criterios de decisión (derivados de la arquitectura, no de preferencia)

1. Cada elección debe **satisfacer la estructura Nivel A** correspondiente (ADR-0002).
2. Debe **preservar la reemplazabilidad**: ningún producto puede volverse Nivel A por comodidad (#16 inv. 2).
3. El **sustrato de IA** debe quedar tras una frontera que permita sustituirlo sin tocar la arquitectura (Independencia Tecnológica, Const. 2.5).

## Insumos que la decisión requiere y que la implementación no posee

No tomo esta decisión por fiat porque hacerlo sería **trasladar autoridad desde la implementación hacia la arquitectura** — lo que la gobernanza prohíbe. La decisión necesita insumos estratégicos que solo la Autoridad puede aportar:

- **equipo y competencias** disponibles (qué ecosistema domina quien va a construir y mantener);
- **destino de despliegue** (nube, on-premise, offline, híbrido);
- **restricciones de datos y soberanía** (dónde pueden residir los datos, marco regulatorio);
- **presupuesto** y tolerancia a dependencias de proveedor;
- **integraciones existentes** que la organización ya usa.

## Decisión

**Reservada.** Se eleva a la Autoridad Estratégica. La implementación de código de la Base Técnica queda en espera de esta decisión; **la especificación tech-neutral (ADR-0002) no depende de ella y avanza.**

## Consecuencias

- Bloquea: el código que realiza la Base Técnica.
- No bloquea: el contrato de conformidad (ADR-0002), verificable contra cualquier stack que se elija.
- Al decidirse: se registra cada ranura con su nivel (Nivel C), justificada contra ADR-0002, y su cambio futuro recorrerá el circuito #8→#6→#7→#5.

## Trazabilidad

#16 (Estratificación A/B/C, §6 reserva de selección) · Const. 2.5 (Independencia Tecnológica) · Directiva de Fase 1 (casos de parada #3, #4).
