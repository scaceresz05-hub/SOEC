# ADR-0026 — Adopción de la Directiva Maestra de M4-D (PROPUESTA)

- **Estado:** **ACEPTADO (ratificado 2026-08-04).** Adopta la Directiva Maestra de M4-D v1.0 como marco de gobernanza obligatorio. Ratificar el marco **no** autoriza implementación real: las decisiones irreversibles D-1..D-7 y el primer piloto siguen pendientes de ratificación separada; `AUTONOMOUS_REAL` permanece bloqueado y la integración sigue en preparación cerrada/simulada.
- **Fecha:** 2026-08-03.
- **Rama:** `feat/macrobloque-4d` (desde `main` = `ae30427`, cierre de la Fundación M4, tag `fundacion-m4`).
- **Relación:** aplica la Directiva Maestra PCE v2.1 (no la modifica) y se apoya en la Fundación M4 sin reabrirla.

## Contexto

La Fundación M4 (M4-A → M4-C-C) quedó consolidada en `main` como infraestructura **neutral, simulada y gobernada**, con `AUTONOMOUS_REAL` bloqueado y sin proveedores/SDK/credenciales/red reales. M4-D es la **primera integración externa real supervisada**. Para evitar que una integración con código de terceros contamine una base ya auditada, M4-D debe partir de un **contrato de aceptación** tan explícito como el que tuvo la Fundación, decidido **antes** de escribir código.

## Decisión (propuesta)

Adoptar la **Directiva Maestra de M4-D** (`docs/governance/DIRECTIVA-MAESTRA-M4-D.md`, borrador **v0.2**) como marco obligatorio de la integración real, con:

- **Principio rector:** un proveedor real es un detalle de implementación tras la frontera, jamás una autoridad.
- **Escala de estados independientes (§0):** proveedor seleccionado → adaptador instalado → credencial configurada → capacidad autorizada → ejecución habilitada; ninguno implica el siguiente.
- **10 ejes obligatorios** (v0.2 endurecida): proveedores/criterios; **lista blanca cerrada y tipada por capacidad**; prohibidos explícitos (clínico identificable, tokens, documentos completos, otros tenants); costos con **topes antes de la llamada + estimación conservadora**; SecretStore productivo; pruebas de no-filtración permanentes; activación progresiva `SIMULADO→SANDBOX→PILOTO→REAL` (PILOTO ≠ REAL: org/volumen/período/personas/kill-switch); rollback honesto (no deshace una divulgación ya hecha: detiene/revoca/rota/bloquea/gestiona retención); criterios de aptitud; **F-CCC-1 verificable** + `verify` sin llamadas reales (smoke real con doble condición).
- **7 decisiones irreversibles pendientes (D-1..D-7)** que **no** se toman en el borrador y requieren ratificación separada por ADR: proveedor concreto (D-1), esquema tipado de datos salientes (D-2), presupuesto/topes (D-3), backend de SecretStore productivo (D-4), alcance del PILOTO (D-5), **política contractual/tratamiento de datos del proveedor** (D-6), **estrategia de residencia y minimización** (D-7).

## Consecuencias

- (+) M4-D nace con un contrato de aceptación claro y con la Fundación M4 como baseline estable e intacto.
- (+) Todo proveedor real (presente o futuro) queda sometido a la arquitectura ya consolidada, no como excepción.
- (−) No habilita nada aún: es gobernanza documental. Ningún adaptador real, SDK, credencial, red, gasto ni smoke real puede introducirse hasta ratificar la directiva y sus decisiones D-1..D-5.

## Alcance de este ADR

Este ADR **sólo** registra la propuesta de adopción del marco. No decide proveedor, datos, presupuesto, secretos ni piloto. No autoriza código funcional. La ratificación de la Directiva Maestra de M4-D v1.0 y de cada decisión irreversible corresponde a la Dirección Técnica humana, en ADRs subsiguientes.
