# Conocimiento del Rubro — Clínica Dental · v1.1

> **Evolución gobernada v1.0 → v1.1 APROBADA (2026-07-22).** **Justificación:** la v1 no contenía una relación causal explícita diagnóstico→objetivo ni aplicabilidad regulatoria específica. **Impacto:** ampliación **aditiva** de la Capa de Producto y del puerto; el Motor de Diagnóstico preserva el valor estructurado para evaluar señales. **Ver §v1.1** al final.
>
> **Gate G1 RESUELTO (2026-07-22)** — ratificación parcial por la Autoridad Estratégica. Patrón: `README.md`. Rubro `clinica-dental`. Instancia: ninguna (Rubro ≠ Instancia).
>
> **Clasificación por capa:**
>
> | Capa | Estado |
> |---|---|
> | Universal | ✅ `RATIFIED` |
> | Regulatoria | ⚠️ `PRELIMINARY` · `PENDING_LEGAL_REVIEW` |
> | Producto | ✅ `RATIFIED` |
>
> **Uso permitido de la capa Regulatoria mientras sea PRELIMINARY:** solo para **advertencias** y **descarte conservador de estrategias**; **nunca** para afirmar cumplimiento legal. Requiere validación jurídica **por jurisdicción** antes de pasar a `RATIFIED`.
>
> **Metadatos por defecto de esta v1** (salvo que la entrada indique otra cosa): `origen` = ratificado por el Director en Gate G1 · `incorporado` = 2026-07-22 · `aparece_en` = v1.0 · `cambio` = creación inicial.

---

## Capa Universal — `RATIFIED`

### Objetivos típicos *(todos medibles)*

| id | Objetivo | Métrica | confidence |
|---|---|---|---|
| `OBJ-CD-01` | Aumentar solicitudes de primera consulta | solicitudes/mes | HIGH |
| `OBJ-CD-02` | Aumentar valoraciones de tratamientos de alto valor (ortodoncia, implantes, estética) | valoraciones agendadas/mes | HIGH |
| `OBJ-CD-03` | Reducir ausentismo a citas (no-shows) | % asistencia | MEDIUM |
| `OBJ-CD-04` | Reactivar pacientes inactivos (recall/controles) | reactivaciones/mes | MEDIUM |
| `OBJ-CD-05` | Mejorar reputación | reseñas nuevas/mes · calificación media | MEDIUM |

*El reconocimiento de marca solo se admite como objetivo secundario; siempre exige un primario medible.*

### Estrategias recomendadas *(→ objetivos que atienden)*

| id | Estrategia | Atiende | confidence |
|---|---|---|---|
| `EST-CD-01` | Captación local orgánica (perfil de negocio, reseñas, contenido educativo) | 01, 05 | HIGH |
| `EST-CD-02` | Contenido educativo de confianza (tratamientos, cuidados, dudas frecuentes) | 01, 02 | HIGH |
| `EST-CD-03` | Recordatorios y recall a la base de pacientes **con consentimiento** | 03, 04 | MEDIUM |
| `EST-CD-04` | Campañas de valoración para tratamientos de alto valor | 02 | MEDIUM |

### Métricas típicas

`MET-CD-01` solicitudes/mes · `MET-CD-02` coste por solicitud · `MET-CD-03` tasa de agendamiento · `MET-CD-04` % asistencia · `MET-CD-05` valor medio por tratamiento · `MET-CD-06` reseñas/mes. *(Cada objetivo declara su costo de medición: medir solicitudes exige formulario/identificador; medir asistencia exige registro de citas.)*

### Embudo frecuente

`EMB-CD-01`: descubrimiento → interés (contenido) → **solicitud** (formulario/llamada) → **valoración agendada** → tratamiento → seguimiento/recall. · confidence HIGH.

### Restricciones generales *(no regulatorias)*

`RES-CD-01` no prometer resultados · `RES-CD-02` lenguaje claro y no alarmista · `RES-CD-03` foco geográfico local.

### Supuestos del rubro *(hipótesis generales — pueden cambiar)*

| id | Supuesto | confidence |
|---|---|---|
| `SUP-CD-01` | La mayoría de las clínicas operan localmente (radio geográfico acotado) | MEDIUM |
| `SUP-CD-02` | Una parte importante del descubrimiento depende de búsquedas y mapas (Google) | MEDIUM |
| `SUP-CD-03` | El no-show suele ser un problema frecuente | MEDIUM |
| `SUP-CD-04` | Los tratamientos de alto valor requieren más confianza y un ciclo de decisión más largo | MEDIUM |

*Los supuestos orientan hipótesis pero no se afirman como hechos; el diagnóstico de la instancia los confirma o los descarta.*

---

## Capa Regulatoria — `PRELIMINARY` · `PENDING_LEGAL_REVIEW`

> **Advertencia:** borrador conservador, **no** asesoría legal. Requiere validación por autoridad cualificada **y por jurisdicción** (varía entre Chile, España, México, Argentina… y con el tiempo). Ante duda, prevalece la regla más restrictiva. Todas las entradas: `estado` = PRELIMINARY · `verification_status` = PENDING_LEGAL_REVIEW.

| id | Regla | Rigor | confidence |
|---|---|---|---|
| `REG-CD-01` | Prohibido usar datos de pacientes en marketing sin consentimiento explícito (datos de salud = categoría especial) | DURA | HIGH |
| `REG-CD-02` | Prohibido prometer o garantizar resultados clínicos | DURA | HIGH |
| `REG-CD-03` | Prohibidas comparaciones no demostrables o afirmaciones de superioridad sin evidencia | DURA | HIGH |
| `REG-CD-04` | Cumplir las normas de publicidad de servicios de salud y de profesionales (autoridad sanitaria / colegios) — *varía por jurisdicción* | DURA | LOW |
| `REG-CD-05` | Prohibido usar imágenes de pacientes o «antes/después» sin consentimiento y sin cumplir la norma local | DURA | MEDIUM |

*Estas reglas generalizan al rubro las prohibiciones clínicas del piloto; ninguna instancia (p. ej. SmileFlow) las define — solo las valida.*

---

## Capa de Producto — `RATIFIED`

### Preguntas de diagnóstico *(mapeo)*

`PRD-CD-01`: qué tratamientos ofrece · ticket / tratamientos de alto valor · capacidad de agenda · de dónde vienen hoy los pacientes · **cuál es el cuello de botella** (pocas solicitudes / muchas solicitudes pero pocas agendan / mucho no-show / poca recompra).

### Construcción de hipótesis

`PRD-CD-02`: el cuello de botella declarado + señales del diagnóstico seleccionan un subconjunto de objetivos candidatos; cada uno se ofrece como **hipótesis con evidencia**, nunca como certeza.

### Priorización de estrategias

`PRD-CD-03`: por (a) **evaluabilidad** (¿se puede medir?), (b) **reversibilidad/riesgo**, (c) ajuste al cuello de botella, (d) **cumplimiento regulatorio** (una estrategia que roce la Capa Regulatoria se descarta o se marca como advertencia — nunca se afirma cumplimiento).

### Plantilla de explicación *(cumple §9.c de la directiva)*

`PRD-CD-04`:
> «Propongo **[objetivo]** porque **detecté** [X en tu diagnóstico] y **observé** [Y, señal o supuesto del rubro]; **para medirlo necesitaré** [Z]; **todavía me falta** [W].»

---

## Backlog (NO activo en v1)

| id | Elemento | Estado |
|---|---|---|
| `OBJ-CD-06` | Fidelización del paciente (crecer por recurrencia, no solo captación) | `DRAFT` — propuesto para v2 |

---

## Gobernanza de este activo

Cambiar la clasificación o el contenido oficial exige **justificación + análisis de impacto + aprobación del Director**, registrada aquí y en el CHANGELOG. Ruta prevista de la capa Regulatoria: `PRELIMINARY` → (validación jurídica por jurisdicción) → `RATIFIED`.

---

## §v1.1 — Capa de Producto causal (RATIFIED, aprobada 2026-07-22)

**Preguntas señalizadas** (cerradas sí/no) añadidas a `PRD-CD-01`; su afirmación (`valor: true`) activa una señal. La señal **no** se activa por la mera existencia de un hecho: requiere que el valor cumpla la condición (`INACTIVA` si es «no»; `INDETERMINADA` si no se responde; `CONTRADICTORIA` si hay contradicción).

**Señales `SIG-CD-*`** (`RATIFIED`, condición `IGUAL_A true`):

| id | nombre | pregunta |
|---|---|---|
| `SIG-CD-01` | POCAS_SOLICITUDES | ¿…pocas solicitudes de primera consulta? |
| `SIG-CD-02` | BAJA_TASA_AGENDAMIENTO | ¿…solicitudes pero pocas terminan en cita agendada? |
| `SIG-CD-03` | ALTO_NO_SHOW | ¿…ausentismo alto (no-show)? |
| `SIG-CD-04` | POCA_RECOMPRA | ¿…poca recompra/recurrencia? |

**Mapeos `MAP-CD-*`** (`RATIFIED`, versionados) — **solo una señal ACTIVA habilita su mapeo**:

| id | señal | → objetivo | → estrategia |
|---|---|---|---|
| `MAP-CD-01` | SIG-CD-01 | `OBJ-CD-01` | `EST-CD-01` |
| `MAP-CD-02` | SIG-CD-02 | **`OBJ-CD-07`** | **`EST-CD-05`** |
| `MAP-CD-03` | SIG-CD-03 | `OBJ-CD-03` | `EST-CD-03` |
| `MAP-CD-04` | SIG-CD-04 | `OBJ-CD-04` | `EST-CD-03` |

**Corrección `MAP-CD-02`:** la baja conversión solicitud→agenda NO deriva a «tratamientos de alto valor». Se añaden:
- **`OBJ-CD-07`** (`RATIFIED`, `HIGH`) — *Aumentar la tasa de agendamiento de solicitudes* · métrica: porcentaje de solicitudes que terminan en cita agendada.
- **`EST-CD-05`** (`RATIFIED`) — *Optimización de respuesta y agendamiento* (seguimiento oportuno, reducción de fricción, claridad del siguiente paso, revisión del proceso de contacto).

`OBJ-CD-02` / `EST-CD-04` siguen válidos, pero solo bajo una señal específica de oportunidad/demanda de alto valor (no por baja conversión general).

> **Nota de integridad de identidad:** el nuevo objetivo de agendamiento se registró como **`OBJ-CD-07`**, no `OBJ-CD-06`: este último ya identifica «Fidelización» (`DRAFT`) desde v1.0 y los IDs son permanentes.

**Activadores regulatorios tipados** (`ActivadorRegulatorio`): `USA_DATOS_DE_PACIENTES`, `CONTACTA_BASE_EXISTENTE`, `USA_IMAGEN_DE_PACIENTE`, `USA_ANTES_DESPUES`, `AFIRMA_RESULTADO_CLINICO`. Cada **estrategia** declara los activadores que puede implicar; cada **regla** declara los que observa. La regla se activa **por candidato/estrategia** solo si comparten activador (`ADVIERTE` o `BLOQUEA`); una estrategia educativa (`EST-CD-01/02`, sin activadores) no carga advertencias de imágenes. Ninguna regla `PRELIMINARY` certifica cumplimiento.

| estrategia | activadores | regla activada |
|---|---|---|
| `EST-CD-03` (recall con consentimiento) | CONTACTA_BASE_EXISTENTE, USA_DATOS_DE_PACIENTES | `REG-CD-01` (ADVIERTE) |
| `EST-CD-05` (optimización agendamiento) | USA_DATOS_DE_PACIENTES | `REG-CD-01` (ADVIERTE) |
| `EST-CD-01/02/04` | — | ninguna |
