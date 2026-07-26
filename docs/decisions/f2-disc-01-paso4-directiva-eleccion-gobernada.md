# Directiva F2-DISC-01 · Paso 4 — Elección Gobernada y Versionado del Objetivo

> **Documento de diseño aprobado** por la Autoridad Estratégica (2026-07-23). Base del bloque de implementación del Paso 4. Subordinado al Modelo Operativo (`docs/producto/MODELO-OPERATIVO-SOEC.md`) y a la directiva base F2-DISC-01.
>
> **Estado:** ✅ Diseño aprobado — implementar en bloque separado, deteniéndose antes de cualquier conversión a objetivo operativo o Preparación.

---

## §0. Encuadre
Realiza el eslabón humano del arco: **candidato propuesto → revisión humana → decisión gobernada y trazable → objetivo versionado**. Registra una **decisión institucional**, no una ejecución. Es el **primer punto del arco que persiste de forma durable** (los pasos 1–3 fueron puros/en memoria): recién aquí existe algo que la organización debe recordar aunque el sistema reinicie. La primera escritura durable del arco es el **evento de decisión** — no antes.

## §1. Objetivo del bloque
Que el Director registre una **decisión** sobre una `PROPUESTA` del Paso 3 —**aceptar** un candidato o **rechazar** la propuesta— y que esa decisión quede **congelada, justificada, versionada y auditable**, sin producir ningún efecto operativo. Una decisión de aceptación produce un **objetivo vigente**; toda decisión (aceptación o rechazo) queda en el **historial**.

## §2. Definiciones fijadas

1. **Qué es una decisión** *(jurídica/operativamente)*: un **acto humano deliberado** sobre una propuesta. Es una **decisión reservada** (no delegable a SOEC), registrada **append-only**; **no es una orden de ejecución**.
2. **Elección ≠ Aceptación (ajuste B):** no toda decisión acepta un candidato. Se modela un único evento **`DecisionRegistrada`** con `resultado: ACEPTADO | RECHAZADO`. `RECHAZADO` («ninguno») también es una decisión institucional valiosa: registra que SOEC propuso y el Director decidió no seguir ninguna propuesta.
3. **Quién puede decidir:** solo un **actor humano con rol autorizado** (Director/Propietario; reutiliza el modelo de permisos por rol de `@soec/control`). SOEC nunca decide.
4. **Qué queda congelado (ajuste A — la propuesta COMPLETA):** una **instantánea inmutable por valor** que contiene:
   - **Comprensión** (la `ComprensionEvaluable` que originó la propuesta);
   - **`ResultadoEstrategia` completo** (todos los candidatos con su explicación, cobertura, advertencias regulatorias, confianza y estrategias sugeridas — *lo que el Director efectivamente vio*);
   - **Candidato elegido** (si `ACEPTADO`);
   - **Versión exacta del rubro** (`rubroId` + `huellaCompleta` SHA-256);
   - **Actor**, **momento** y **justificación**.
   Así la auditoría responde no solo *¿cuál eligió?* sino *¿qué alternativas rechazó?*.
5. **Justificación estructurada (ajuste C):** `JustificacionHumana { texto: string; categoria: NEGOCIO | PRESUPUESTO | RIESGO | REGULATORIO | PRIORIDAD | OTRO }`. Obligatoria (texto no vacío); la categoría orienta el aprendizaje futuro sin limitar al usuario. Una decisión sin justificación se rechaza.
6. **Reemplazo / revocación / superación** (append-only): una nueva `DecisionRegistrada` puede **superar** (`reemplazaA`) una anterior; `DecisionRevocada` (con motivo) deja sin efecto la vigente. Nunca se muta ni se borra; la **proyección** deriva lo vigente y conserva el historial.
7. **Elegido / vigente / histórico:** *decisión registrada* = un evento concreto; *objetivo vigente* = el objetivo de la última decisión `ACEPTADO` no revocada ni superada (una `RECHAZADO` no produce vigente); *histórico* = todas las decisiones anteriores, preservadas.
8. **Decidir ≠ ejecutar:** el evento **no produce efecto**. El paquete no importa adaptadores ni `@soec/{operacional,canales,marketing}`, no planifica, no agenda. Prueba de no-efecto.

## §3. Frontera (dura)
`candidato → revisión humana → decisión gobernada y trazable → objetivo versionado`. **Nunca** `decisión → campaña / publicación / gasto / acción automática`. El registro **es un hecho de gobierno, no un disparador**.

## §4. Identidad del agregado (ajuste 3)
Agregado por **Organización + Departamento (capacidad de negocio)**:
```
ObjetivoDecisionAggregateId = OrganizationId + departamentoId
```
`departamentoId` identifica el departamento autónomo (hoy `marketing`; mañana `ventas`, `finanzas`, `rrhh`, `operaciones`, `compras`). *Nota de nomenclatura:* NO reutilizar `CapabilityId` de `@soec/capacidades` (que designa la capacidad cognitiva `comprender-el-estado`); son dominios distintos.
**Invariante:** **a lo sumo un objetivo vigente por Organización + Departamento.** Escala sin rediseño al aparecer nuevos departamentos.

## §5. Distinción de dominio y nombre del paquete
El **objetivo elegido** (registro gobernado con instantáneas + justificación) **NO es** el `Objetivo` operativo de `@soec/marketing` (que alimenta el planificador). Convertir uno en otro es **Preparación**, fuera de alcance — así se mantiene *decidir ≠ ejecutar*. Por eso el paquete pertenece al **gobierno**, no al objetivo operativo: se llama **`@soec/decision`** (administra elegir / rechazar / reemplazar / revocar), no `@soec/objetivo`.

## §6. Alcance del checkpoint (ajuste 2)
**Solo motor de decisión**, sin consumidor: dominio · agregado · eventos · reducer · servicio de aplicación · persistencia · reconstrucción · autorización. **Sin API/UI.** El consumidor (que permite al Director revisar y elegir) es un **checkpoint independiente posterior** — misma disciplina que Diagnóstico y Estrategia: motor primero, consumidor después.

## §7. Estructura técnica
Paquete **event-sourced** `@soec/decision`:
- **Dominio:** agregado `decision:<org>:<departamento>`; eventos `DecisionRegistrada` (ACEPTADO/RECHAZADO, con instantánea completa y justificación estructurada; opcional `reemplazaA`) y `DecisionRevocada`; reducer → `{ vigente: ObjetivoVigente | null, historial: DecisionRegistrada[] }`.
- **Persistencia:** migración **`0013`** (primera escritura durable del arco); proyección reconstruible; worker de drenaje extendido.
- **Aplicación:** servicio con **verificación de rol** (solo humano autorizado), **justificación obligatoria**, idempotencia por identidad de decisión, **aislamiento multiempresa**.

## §8. Invariantes del registro
Append-only e inmutable; **a lo sumo un objetivo vigente por Organización + Departamento**; toda decisión referencia una propuesta trazable a comprensión+rubro (instantánea completa); instantáneas inmutables y completas (rubro huella + comprensión + `ResultadoEstrategia`); decidir **no emite efecto**; multiempresa aislado; proyección reconstruible idéntica desde cero.

## §9. Fuera de alcance hasta Preparación
Conectar cuentas, planes, campañas, publicación, gasto, activación; **la conversión del objetivo elegido en `Objetivo` operativo de marketing** (Preparación); la concretización del *activador seleccionado* del plan concreto; el consumidor API/UI; cualquier efecto real.

## §10. Criterios de cierre + pruebas mínimas
`tsc`/`eslint`/`prettier` limpios; migración desde base recién creada (`0001…0013`); contenedores `ssr_*` intactos. Pruebas:
- decisión `ACEPTADO` → **objetivo vigente** con instantánea completa (comprensión + `ResultadoEstrategia` + candidato + rubro huella);
- decisión `RECHAZADO` → registrada, **sin objetivo vigente**, con la propuesta rechazada conservada;
- **justificación obligatoria** y **estructurada** (rechazo sin texto; categoría dentro del conjunto cerrado);
- **autorización** (solo actor humano con rol; SOEC/otros roles rechazados);
- **reemplazo/revocación** append-only con vigente recomputado e historial preservado;
- **a lo sumo un objetivo vigente** por Organización + Departamento;
- **decidir no produce efecto** (sin adaptadores; MED/MDM/plan intactos — prueba arquitectónica);
- **aislamiento multiempresa**; reconstrucción de proyección idéntica desde cero; **sin push**.
