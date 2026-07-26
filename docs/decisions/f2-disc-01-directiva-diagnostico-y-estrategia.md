# Directiva F2-DISC-01 — Diagnóstico y Estrategia (vertical Clínica Dental)

> **Directiva oficial de ejecución** aprobada por la Autoridad Estratégica (2026-07-22). Base del primer bloque de implementación derivado del Modelo Operativo.
>
> **Versión:** 1.0 · **Estado:** ✅ Aprobada — lista para implementar en bloque separado.
>
> **Subordinada a:** `docs/producto/MODELO-OPERATIVO-SOEC.md` (realiza sus fases 1–2, §9) y a las fuentes declarantes que éste remite. No modifica la Biblioteca Maestra ni el Modelo Operativo.

---

## §0. Encuadre

Realiza las **dos primeras fases** del Modelo Operativo —**Diagnóstico** y **Estrategia**— para **un solo rubro: Clínica Dental**. **Sin efectos reales, sin IA generativa, todo determinista y evaluable.** No aborda Preparación ni Operación, ni el rediseño de la experiencia (posterior).

## §1. Objetivo del bloque

Que una clínica dental, partiendo de **no saber qué objetivo definir**, reciba de SOEC **2–3 objetivos/estrategias candidatos fundados** y **elija uno**, quedando ese objetivo registrado y evaluable — listo para que una futura fase de Preparación lo tome. El acto central es *proponer con fundamento y que el humano elija*, no configurar.

## §2. Alcance INCLUIDO

1. **Conocimiento del rubro «Clínica Dental»** — activo curado, **versionado**, evaluable y **estrictamente separado de toda instancia** (Rubro ≠ Instancia, Modelo Operativo §6). Estructurado en tres capas (§6).
2. **Diagnóstico guiado** — preguntas estructuradas (respuestas mayormente elegibles + texto libre mínimo) que alimentan el **motor de comprensión ya existente** («Comprender el estado», F1-UI-01) **reconectado**, produciendo una comprensión **evaluable**: qué se comprendió y **qué falta** (la ausencia no es conclusión).
3. **Estrategia (propuesta)** — motor determinista que, a partir de la comprensión + el conocimiento del rubro, genera **≥2 candidatos** con razón, métricas, **costo de medición**, **clasificación de evidencia** (hipótesis, no certeza) y **explicación evaluable** (§9.c). El humano **elige o edita**; la elección queda **versionada** como el objetivo de la instancia.

## §3. Alcance EXCLUIDO (guardarraíles duros)

- **Ningún efecto real:** sin publicación, gasto, credenciales ni conexión de cuentas; modo real inalcanzable.
- **Sin IA generativa:** todo determinista/evaluable.
- **Un solo rubro de producto:** solo Clínica Dental; **no** catálogo multi-rubro.
- **No contaminar el rubro con la instancia:** una clínica concreta solo **valida**; sus datos nunca entran al conocimiento de rubro.
- **No** unificación de experiencia ni rediseño de pantallas (F2-UX-UNIFY-01, posterior).
- **No** Preparación ni Operación; el objetivo elegido **no** dispara ninguna fase siguiente.
- **No** modificar la Biblioteca Maestra ni el Modelo Operativo.

## §4. Principios que gobiernan (remisiones)

Evaluabilidad y «propuesta = hipótesis» (Filosofía #3) · **objetivo siempre medible** (Modelo Operativo §16) · honestidad de capacidades (#4 §3) · Rubro ≠ Instancia (Modelo Operativo §6). Este bloque **aplica** estas reglas; no legisla ninguna.

## §5. Estructura técnica y separación motor ↔ conocimiento

- **Nuevo paquete de conocimiento sectorial** (p. ej. `@soec/rubros`), sin dependencias `@soec/*` salvo `contracts`; contenido versionado con huella determinista; **aislado por prueba arquitectónica** de todo agregado de instancia.
- **Capa de aplicación Diagnóstico + Estrategia** que **compone** el motor de comprensión existente (`@soec/operaciones` / experiencia `comprender-estado`) y el planificador de objetivos de `@soec/marketing` (`validarObjetivo`, objetivo→plan), sin invertir dependencias.
- **Mandato de separación (regla del bloque):** el motor de Diagnóstico y Estrategia **nunca contendrá conocimiento del rubro embebido**. Todo conocimiento proviene **exclusivamente** del activo versionado del rubro, inyectado por una **frontera estable**. El mismo motor debe funcionar para Clínica Dental, Clínica Médica, Estudio Jurídico, Constructora o Restaurante **sin cambiar una línea de lógica** — verificable por prueba (§9.e).
- La forma exacta (paquetes, fronteras, migración) se fija **inspeccionando la estructura real** en el bloque de implementación, no aquí.

## §6. Conocimiento del rubro — TRES CAPAS separadas desde el inicio

El activo del rubro se divide, desde el origen, en tres capas versionadas de forma independiente:

1. **Conocimiento universal del rubro** — objetivos típicos, estrategias, métricas, embudos, restricciones generales.
2. **Conocimiento regulatorio** — prohibiciones, límites legales, restricciones sanitarias, **reglas que nunca pueden romperse**. Separado para **actualizarse sin afectar el resto del modelo**; tratado como **duro por defecto**.
3. **Conocimiento de producto** — cómo SOEC interpreta el rubro, cómo construye hipótesis, cómo prioriza estrategias.

Las tres capas son parte del activo gobernado por el Gate G1 (§7).

## §7. Gate G1 — Aprobación del Conocimiento del Rubro (HITO OBLIGATORIO)

> **Ninguna implementación podrá continuar más allá del motor de Diagnóstico hasta que el conocimiento del rubro haya sido aprobado explícitamente por el Director.** El conocimiento aprobado pasa a ser la versión oficial (`v1`) del rubro «Clínica Dental»; cualquier modificación posterior requerirá **justificación, análisis de impacto y aprobación explícita**.

El conocimiento del rubro es un **activo gobernado**, no un detalle de implementación. Procedimiento: en el bloque de implementación, Claude redacta una **v1 conservadora** de las tres capas (§6) —las reglas regulatorias como **duras**— y **se detiene en G1**; el Director la ratifica antes de que SOEC la use para proponer nada. Sin aprobación de G1, la fase de Estrategia no se activa.

## §8. Validación contra instancia

Correr Diagnóstico + Estrategia con los datos de **una clínica dental de prueba** y verificar que los candidatos son sensatos y evaluables, **comprobando que ninguna respuesta de la instancia se filtró al conocimiento de rubro** (prueba arquitectónica).

## §9. Criterios de cierre (evidencia objetiva)

a. `typecheck` / `lint` / `test` verdes (todos los workspaces).
b. Conocimiento de rubro **versionado, en tres capas y aislado de instancia** (prueba); **Gate G1 registrado como aprobado** antes de usarse.
c. **Explicabilidad (nuevo):** cada objetivo/estrategia propuesta entrega su **explicación evaluable** — *detecté X · observé Y · para medirlo necesito Z · todavía me falta W*. Un candidato sin explicación evaluable **no se muestra**. (Evaluabilidad, Modelo Operativo §5.)
d. Estrategia produce **≥2 candidatos** con evidencia clasificada y **ninguno certificado sin base**; el diagnóstico **declara faltantes**; el objetivo elegido queda **versionado**.
e. **Motor agnóstico del rubro (nuevo):** prueba con un **rubro-fixture mínimo distinto** (fixture de prueba, no un vertical de producto) que demuestra que el motor produce candidatos coherentes **sin cambiar una línea de lógica** (verifica §5).
f. **Cero efectos reales** (prueba) · **validación viva** del recorrido Diagnóstico→Estrategia para clínica dental · migración desde base recién creada · contenedores `ssr_*` intactos · docs sincronizados · **sin push**.

## §10. Entregables

Paquete(s) de conocimiento sectorial + capa de aplicación Diagnóstico/Estrategia; conocimiento de rubro v1 en tres capas (ratificado en G1); recorrido Diagnóstico→Estrategia funcionando en la app viva para clínica dental; pruebas (Rubro≠Instancia, motor agnóstico, explicabilidad, no-efecto); ADR si corresponde; MASTER_STATUS / CHANGELOG sincronizados.

## §11. Lo que queda explícitamente para después

**F2-UX-UNIFY-01** (experiencia unificada de una sola empresa, con Preparación y Operación visibles) y la conexión del objetivo elegido con el resto del recorrido. Este bloque entrega **el acuerdo** (Diagnóstico + Estrategia), no el trabajo operativo.

## §12. Puntos de parada

Los seis casos del régimen de Fase 1 más, específicamente: **Gate G1** (§7), la aparición de una necesidad de IA real, o cualquier contradicción con el Modelo Operativo.
