# ADR-0016 — Decisión Institucional Gobernada (F2-DISC-01, Paso 4)

- **Estado:** ✅ **ACEPTADO.** Cierra el arco F2-DISC-01 (Diagnóstico → Comprensión → Señales → Mapeos → Candidatos → **Decisión institucional**) con la primera persistencia durable de gobierno. Continúa ADR-0009…0015.
- **Fecha:** 2026-07-23 · **Bloque:** F2-DISC-01 (pasos 1–4: `@soec/rubros` v1.1, `@soec/diagnostico`, `@soec/estrategia`, `@soec/decision`).

## Contexto

El arco F2-DISC-01 produjo **conocimiento** (rubro), **comprensión evaluable** (diagnóstico), y **candidatos de estrategia** derivados causalmente (señal activa → mapeo versionado → objetivo/estrategia). Faltaba el **acto humano**: elegir. Este ADR fija `@soec/decision`, el primer paquete del arco con **persistencia durable**, que registra la decisión institucional sin ejecutarla. La conversión de la decisión en un objetivo operativo pertenece a **Preparación**, fuera de alcance.

## Decisiones

### D-1. Dominio de GOBIERNO, separado del objetivo operativo *(Nivel A)*
`@soec/decision` administra elegir/rechazar/reemplazar/revocar; **no es** el `Objetivo` operativo de `@soec/marketing`. Nombres propios (`objdecision:<org>:<dep>`, tabla `proj_objetivo_decision_current`) para no colisionar con la bandeja de `@soec/control` (`proj_decision_current`, streams `decision:*`).

### D-2. Agregado por Organización + Departamento *(Nivel A)*
Clave `OrganizationId + departamentoId` (capacidad de negocio; **no** el `CapabilityId` cognitivo). Invariante **a lo sumo un objetivo vigente por par**, protegida por el dominio **y** por el EventStore (concurrencia optimista `expectedVersion` → `ConcurrencyError`; idempotencia por `idempotencyKey`).

### D-3. Ciclo de vida explícito, sin resurrección histórica *(Nivel A)*
Estados de registro `VIGENTE / SUPERADA / REVOCADA / RECHAZADA`. Una aceptación supera **explícitamente** a la vigente (`reemplazaDecisionId` verificado); revocar la vigente deja `vigente=null` **sin reactivar** una superada; un `RECHAZADO` no altera el vigente; solo la vigente es revocable.

### D-4. Snapshot íntegro + justificación + autorización *(Nivel A)*
Se congela por valor la propuesta completa (comprensión + `ResultadoEstrategia` + candidato + huella del rubro) con `snapshotSchemaVersion` y **`snapshotHash` (SHA-256)** sobre representación canónica; `verificarIntegridadSnapshot` detecta alteraciones. Justificación estructurada `{texto, categoria}` obligatoria. Autorización por rol (permiso `decisiones:decidir`); el actor humano queda registrado como evidencia.

### D-5. Decidir ≠ ejecutar *(Nivel A — límite de arquitectura)*
El evento de decisión **no produce efecto operativo** (prueba arquitectónica: sin adaptadores ni módulos de operación). `Decisión ≠ Preparación ≠ Operación`.

### D-6. `ResultadoDecision` deliberadamente pequeño en v1 *(Nivel C — decisión diferida)*
El enum es, a propósito, **mínimo**: `ACEPTADO | RECHAZADO`. Una decisión institucional suele tener un ciclo de vida más rico; se **anticipa** —sin implementar— la aparición futura de estados como `POSPUESTO`, `NECESITA_MAS_INFORMACION`, `DERIVADO`, `EXPIRADO`. **No se incorporan hoy**: se ampliará por enmienda gobernada cuando exista una necesidad real (regla del proyecto: no abstraer antes de tiempo). Este ADR deja constancia de que la pequeñez del enum v1 fue una decisión consciente, no una omisión.

### D-7. Migración gobernada `0013_objetivo_decision` *(Nivel C)*
Caso A (base local descartable; sin remoto ni push). Cadena `0001…0013` aplicada desde base vacía, idempotente, coexistiendo con las tablas de `@soec/control` sin tocarlas, con un único id inequívoco y **sin borrado manual** requerido en base limpia.

## Consecuencias
SOEC posee un flujo completo y coherente **Conocimiento → Comprensión → Estrategia → Decisión institucional** sin ejecutar aún ninguna acción sobre el negocio. Preparación ya no decide *qué hacer*: solo transforma una decisión humana versionada y auditada en un plan operativo. El consumidor (revisar/elegir) y Preparación quedan como bloques posteriores.
